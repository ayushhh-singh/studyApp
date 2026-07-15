/**
 * ingest:hindi-overlay — restore UPPSC's OWN printed Hindi for question
 * stems/options that were previously machine-translated from English.
 *
 * Context: every UPPSC PYQ ingested so far had its Hindi REGENERATED from the
 * clean English via haiku translation, because the source PDFs encode Hindi in
 * a legacy non-Unicode font whose text layer is mojibake (see pyq.ts +
 * CLAUDE.md). The Hindi glyphs ARE printed on the page, though — so a VISUAL
 * read of the rasterized page recovers UPPSC's real wording. Subagents do that
 * read (Hindi + English columns, keyed by printed option label) and write
 * per-chunk JSON; this tool MERGES + VALIDATES those chunks against the live DB
 * rows and overlays the source-extracted Hindi.
 *
 *   pnpm ingest:hindi-overlay --paper PRE_GS1 --year 2024 --chunks <dir>          (plan only)
 *   pnpm ingest:hindi-overlay --paper PRE_GS1 --year 2024 --chunks <dir> --apply  (write DB)
 *
 * HARD PRECONDITION (caller's responsibility): only run against a source PDF
 * that is a genuine Hindi+English printed bilingual original. An English-only
 * source has no Hindi to read — those rows stay correctly machine_translated.
 *
 * Integrity gates (a mis-read here would silently corrupt which option is
 * "correct", exactly the class of bug this codebase has hit with reordering):
 *  - English cross-check: the agent independently transcribes BOTH columns; we
 *    require the agent's English stem AND every option's English to match the
 *    live DB row (per option KEY) before trusting that option's Hindi. This is
 *    the permutation/key-order check — Hindi is only ever assigned to a key
 *    whose English content we confirmed aligned.
 *  - Key-set equality: the extracted option keys must exactly equal the DB
 *    option keys (count + set); order is preserved because we keep the DB
 *    options array and only fill `.hi` by key.
 *  - Double-read agreement: page ranges overlap, so most questions are read by
 *    two independent agents; when ≥2 valid reads exist their Hindi must agree,
 *    else the question is rejected as ambiguous (honesty over coverage).
 *  - Legibility: any [अस्पष्ट]/[illegible] span, empty Hindi, or legible=false
 *    leaves the row machine_translated — never a guess (same rule as OCR).
 *
 * Provenance: on success sets meta.hindi_source='source_extracted' and
 * machine_translated=false (drops it out of the Review Queue's mt tab). Rows we
 * could NOT confidently replace get meta.hindi_source='machine_translated' and
 * stay flagged. The parsed content-raw/parsed/pyq_<id>.json (if present) is
 * updated in lockstep so a future ingest:pyq:load carries the corrected Hindi
 * forward instead of clobbering it with the old machine translation.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { supabase } from "../lib/supabase.js";
import { PARSED_DIR, parseArgs, report } from "./_shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ChunkOption {
  key: string;
  text_en: string;
  text_hi: string;
}
interface ChunkQuestion {
  q_no: number;
  stem_en: string;
  stem_hi: string;
  options: ChunkOption[];
  legible?: boolean;
  note?: string;
}
interface ChunkFile {
  chunk?: string;
  pages?: string;
  questions: ChunkQuestion[];
}

interface DbOption {
  key: string;
  en: string;
  hi: string;
}
interface TargetRow {
  id: string;
  external_id: string;
  q_no: number | null;
  correct_option_key: string | null;
  stem_en: string;
  stem_hi: string;
  options: DbOption[];
}

// ---------------------------------------------------------------------------
// Similarity (bigram Dice on normalized text) — tolerant of minor OCR-ish
// transcription differences while still catching a genuinely different string.
// ---------------------------------------------------------------------------
// Fold notation that differs only by encoding so the English cross-check on
// quant/geometry options (e.g. "2x³" vs "2x3", "120°" vs "120º") isn't a false
// mismatch. Superscript/subscript digits → ASCII; degree/ordinal marks dropped
// by the \p{L}\p{N} filter below (º is a letter, so map it away explicitly).
const SUPERSUB: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "º": "", "°": "",
};
function norm(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉º°]/g, (c) => SUPERSUB[c] ?? c)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}
function bigrams(s: string): Map<string, number> {
  const t = s.replace(/ /g, "");
  const g = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    g.set(b, (g.get(b) ?? 0) + 1);
  }
  return g;
}
function dice(aRaw: string, bRaw: string): number {
  const a = norm(aRaw);
  const b = norm(bRaw);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Too short for meaningful bigrams (e.g. single-token numeric codes) →
  // exact-match only after normalization.
  if (a.replace(/ /g, "").length < 2 || b.replace(/ /g, "").length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [k, v] of ga) if (gb.has(k)) inter += Math.min(v, gb.get(k)!);
  const sa = [...ga.values()].reduce((x, y) => x + y, 0);
  const sb = [...gb.values()].reduce((x, y) => x + y, 0);
  return sa + sb === 0 ? (a === b ? 1 : 0) : (2 * inter) / (sa + sb);
}

const ILLEGIBLE = /\[\s*(अस्पष्ट|illegible|unclear|अपाठ्य)\s*\]/i;
function hasIllegible(s: string | undefined | null): boolean {
  return ILLEGIBLE.test(s ?? "");
}

/**
 * A "code-like" option is a language-neutral matching/statement code —
 * e.g. "2 3 4 1", "A-1, B-2, C-3, D-4", "1, 3 and 4" — printed identically in
 * both columns. Its Hindi is NOT real bilingual text, so we do NOT overwrite it
 * (that would only introduce format drift vs the unchanged English); instead we
 * verify alignment by comparing the ANSWER DIGIT SEQUENCE per key, which is a
 * strict permutation guard (a swapped option changes the sequence). Anything
 * with real words ("Only 4", "and", "Neither") is textual → cross-checked and
 * overlaid normally.
 */
function codeLike(s: string): boolean {
  const t = (s ?? "").trim();
  return t.length > 0 && /\d/.test(t) && /^[0-9A-D().,\-/;:\s]+$/i.test(t);
}
function digitSeq(s: string): string {
  return (s.match(/\d/g) ?? []).join("");
}

// ---------------------------------------------------------------------------
// Validation of one candidate extraction against the live DB row
// ---------------------------------------------------------------------------
interface EvalResult {
  ok: boolean;
  reason?: string;
  stemScore: number;
  optScore: number;
  /** Per-key resolved Hindi: kind 'source' = overlay agent text; 'kept' = keep
   * DB value (language-neutral code option). Present only when ok. */
  resolved?: Map<string, { new_hi: string; kind: "source" | "kept" }>;
}
function evaluateCandidate(cand: ChunkQuestion, row: TargetRow, minStem: number, minOpt: number): EvalResult {
  // Legibility / presence.
  if (cand.legible === false) return { ok: false, reason: "agent flagged illegible", stemScore: 0, optScore: 0 };
  if (!cand.stem_hi || !cand.stem_hi.trim())
    return { ok: false, reason: "empty Hindi stem", stemScore: 0, optScore: 0 };
  if (hasIllegible(cand.stem_hi)) return { ok: false, reason: "[अस्पष्ट] in stem", stemScore: 0, optScore: 0 };

  const stemScore = dice(cand.stem_en, row.stem_en);
  if (stemScore < minStem)
    return { ok: false, reason: `stem English mismatch (${stemScore.toFixed(2)})`, stemScore, optScore: 0 };

  // Key-set equality (uppercased). Missing/extra key → reject (permutation guard).
  const candByKey = new Map<string, ChunkOption>();
  for (const o of cand.options ?? []) candByKey.set(o.key.trim().toUpperCase(), o);
  const dbKeys = row.options.map((o) => o.key.trim().toUpperCase()).sort();
  const candKeys = [...candByKey.keys()].sort();
  if (dbKeys.length !== candKeys.length || dbKeys.some((k, i) => k !== candKeys[i]))
    return {
      ok: false,
      reason: `option keys differ (db=[${dbKeys}] read=[${candKeys}])`,
      stemScore,
      optScore: 0,
    };

  // Per-key alignment check → the permutation/key-order guard.
  const resolved = new Map<string, { new_hi: string; kind: "source" | "kept" }>();
  let optScore = 1;
  for (const dbo of row.options) {
    const k = dbo.key.trim().toUpperCase();
    const co = candByKey.get(k)!;
    if (codeLike(dbo.en)) {
      // Language-neutral code: align by digit sequence, keep the DB Hindi.
      const a = digitSeq(co.text_en) || digitSeq(co.text_hi);
      const b = digitSeq(dbo.en);
      const aligned = a && b ? a === b : dice(co.text_en, dbo.en) >= minOpt;
      if (!aligned)
        return { ok: false, reason: `option ${k} code mismatch (db=${b || dbo.en} read=${a})`, stemScore, optScore: 0 };
      resolved.set(k, { new_hi: dbo.hi, kind: "kept" });
      continue;
    }
    // Textual option: require English agreement per key, then overlay Hindi.
    if (!co.text_hi || !co.text_hi.trim() || hasIllegible(co.text_hi))
      return { ok: false, reason: `empty/illegible Hindi option ${k}`, stemScore, optScore };
    const s = dice(co.text_en, dbo.en);
    optScore = Math.min(optScore, s);
    if (s < minOpt)
      return { ok: false, reason: `option ${k} English mismatch (${s.toFixed(2)})`, stemScore, optScore: s };
    resolved.set(k, { new_hi: co.text_hi.trim(), kind: "source" });
  }
  return { ok: true, stemScore, optScore, resolved };
}

// ---------------------------------------------------------------------------
// Load DB targets (published MCQ with machine-translated Hindi)
// ---------------------------------------------------------------------------
async function loadTargets(paper: string, year: number): Promise<TargetRow[]> {
  const db = supabase();
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("questions")
      .select("id,external_id,type,is_published,correct_option_key,stem_i18n,options_i18n,meta")
      .eq("paper_code", paper)
      .eq("year", year)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows
    .filter((r) => r.type === "mcq" && r.is_published && r.meta?.machine_translated === true)
    .map((r) => {
      const m = /:(q\d+)$/.exec(r.external_id);
      return {
        id: r.id as string,
        external_id: r.external_id as string,
        q_no: m ? Number(m[1].slice(1)) : null,
        correct_option_key: r.correct_option_key ?? null,
        stem_en: r.stem_i18n?.en ?? "",
        stem_hi: r.stem_i18n?.hi ?? "",
        options: (r.options_i18n ?? []).map((o: any) => ({
          key: o.key,
          en: o.text_i18n?.en ?? "",
          hi: o.text_i18n?.hi ?? "",
        })),
      } as TargetRow;
    })
    .filter((r) => r.q_no != null);
}

async function loadChunks(dir: string): Promise<ChunkQuestion[]> {
  const files = (await readdir(dir)).filter((f) => /^c\d+\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No cN.json chunk files in ${dir}`);
  const all: ChunkQuestion[] = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(join(dir, f), "utf8")) as ChunkFile;
    for (const q of j.questions ?? []) all.push(q);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Merge / plan
// ---------------------------------------------------------------------------
interface AcceptedOption {
  key: string;
  en: string;
  old_hi: string;
  new_hi: string;
  /** 'source' = overlaid from the printed Hindi; 'kept' = language-neutral code, DB value retained. */
  kind: "source" | "kept";
}
interface Accepted {
  id: string;
  external_id: string;
  q_no: number;
  stemScore: number;
  optScore: number;
  reads: number;
  hi_agreement: number | null;
  old_stem_hi: string;
  new_stem_hi: string;
  options: AcceptedOption[];
}
interface Rejected {
  q_no: number;
  reason: string;
}

interface Plan {
  paper: string;
  year: number;
  min_stem: number;
  min_opt: number;
  accepted: Accepted[];
  rejected: Rejected[];
  no_extraction: number[];
}

function buildPlan(
  paper: string,
  year: number,
  targets: TargetRow[],
  candidates: ChunkQuestion[],
  minStem: number,
  minOpt: number,
): Plan {
  const byQ = new Map<number, ChunkQuestion[]>();
  for (const c of candidates) {
    if (typeof c.q_no !== "number") continue;
    if (!byQ.has(c.q_no)) byQ.set(c.q_no, []);
    byQ.get(c.q_no)!.push(c);
  }

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const noExtraction: number[] = [];

  for (const row of targets) {
    const qno = row.q_no!;
    const cands = byQ.get(qno) ?? [];
    if (cands.length === 0) {
      noExtraction.push(qno);
      continue;
    }
    const passers = cands
      .map((c) => ({ c, e: evaluateCandidate(c, row, minStem, minOpt) }))
      .filter((x): x is { c: ChunkQuestion; e: EvalResult & { resolved: Map<string, { new_hi: string; kind: "source" | "kept" }> } } => x.e.ok)
      .sort((a, b) => b.e.stemScore + b.e.optScore - (a.e.stemScore + a.e.optScore));

    if (passers.length === 0) {
      // Surface the best failing reason for the operator.
      const best = cands
        .map((c) => evaluateCandidate(c, row, minStem, minOpt))
        .sort((a, b) => b.stemScore - a.stemScore)[0];
      rejected.push({ q_no: qno, reason: best?.reason ?? "no valid read" });
      continue;
    }

    const top = passers[0];
    // Double-read agreement: when ≥2 independent valid reads exist, their Hindi
    // stems must agree, else the read is ambiguous → reject.
    let hiAgreement: number | null = null;
    if (passers.length >= 2) {
      hiAgreement = dice(top.c.stem_hi, passers[1].c.stem_hi);
      if (hiAgreement < 0.5) {
        rejected.push({
          q_no: qno,
          reason: `ambiguous double-read (Hindi agreement ${hiAgreement.toFixed(2)})`,
        });
        continue;
      }
    }

    const resolved = top.e.resolved;
    accepted.push({
      id: row.id,
      external_id: row.external_id,
      q_no: qno,
      stemScore: Number(top.e.stemScore.toFixed(3)),
      optScore: Number(top.e.optScore.toFixed(3)),
      reads: passers.length,
      hi_agreement: hiAgreement == null ? null : Number(hiAgreement.toFixed(3)),
      old_stem_hi: row.stem_hi,
      new_stem_hi: top.c.stem_hi.trim(),
      options: row.options.map((dbo) => ({
        key: dbo.key,
        en: dbo.en,
        old_hi: dbo.hi,
        new_hi: resolved.get(dbo.key.trim().toUpperCase())!.new_hi,
        kind: resolved.get(dbo.key.trim().toUpperCase())!.kind,
      })),
    });
  }

  accepted.sort((a, b) => a.q_no - b.q_no);
  rejected.sort((a, b) => a.q_no - b.q_no);
  noExtraction.sort((a, b) => a - b);
  return { paper, year, min_stem: minStem, min_opt: minOpt, accepted, rejected, no_extraction: noExtraction };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
async function applyPlan(plan: Plan): Promise<void> {
  const db = supabase();
  let updated = 0;
  for (const a of plan.accepted) {
    // Re-read the row so we never overwrite the (unchanged) English with a
    // stale copy, and patch onto the current row.
    const { data: cur, error: e1 } = await db
      .from("questions")
      .select("stem_i18n,options_i18n,meta")
      .eq("id", a.id)
      .single();
    if (e1 || !cur) {
      report.fail(`q${a.q_no}: re-read failed: ${e1?.message}`);
      continue;
    }
    const newStem = { ...(cur.stem_i18n ?? {}), hi: a.new_stem_hi };
    const hiByKey = new Map(a.options.map((o) => [o.key.trim().toUpperCase(), o.new_hi]));
    const newOptions = (cur.options_i18n ?? []).map((o: any) => {
      const nh = hiByKey.get(String(o.key).trim().toUpperCase());
      return nh == null ? o : { ...o, text_i18n: { ...(o.text_i18n ?? {}), hi: nh } };
    });
    const newMeta = {
      ...(cur.meta ?? {}),
      machine_translated: false,
      hindi_source: "source_extracted",
      hindi_source_verified_at: new Date().toISOString(),
    };
    const { error: e2 } = await db
      .from("questions")
      .update({ stem_i18n: newStem, options_i18n: newOptions, meta: newMeta })
      .eq("id", a.id);
    if (e2) {
      report.fail(`q${a.q_no}: update failed: ${e2.message}`);
      continue;
    }
    updated++;
  }
  report.ok(`DB rows overlaid with source Hindi: ${updated}/${plan.accepted.length}`);

  // Mark the rows we could NOT confidently replace with explicit provenance so
  // future audits distinguish "translated by us" at a glance (they stay
  // machine_translated=true and thus stay in the Review Queue).
  const leftoverIds: string[] = [];
  const targets = await loadTargets(plan.paper, plan.year);
  const acceptedIds = new Set(plan.accepted.map((a) => a.id));
  for (const t of targets) if (!acceptedIds.has(t.id)) leftoverIds.push(t.id);
  for (const id of leftoverIds) {
    const { data: cur } = await db.from("questions").select("meta").eq("id", id).single();
    if (!cur) continue;
    if ((cur.meta as any)?.hindi_source === "machine_translated") continue;
    await db
      .from("questions")
      .update({ meta: { ...(cur.meta ?? {}), hindi_source: "machine_translated" } })
      .eq("id", id);
  }
  if (leftoverIds.length) report.ok(`left ${leftoverIds.length} row(s) flagged hindi_source='machine_translated'`);

  await updateParsedJson(plan);
}

/**
 * Keep the local parsed artifact in sync so a re-run of ingest:pyq:load carries
 * the corrected Hindi + provenance forward instead of clobbering it with the
 * old machine translation. Best-effort: skipped (with a note) if the file is
 * absent. The parsed dir is git-ignored, so this is a local-durability measure.
 */
async function updateParsedJson(plan: Plan): Promise<void> {
  // paper_code → the manifest-id fragment used by the prelims parsed artifacts.
  const PAPER_TO_MANIFEST: Record<string, string> = {
    PRE_GS1: "prelims_{year}_gs1",
    PRE_CSAT: "prelims_{year}_csat",
  };
  const frag = PAPER_TO_MANIFEST[plan.paper];
  if (!frag) {
    report.warn(`no parsed-artifact mapping for ${plan.paper} — DB updated, parsed JSON not synced`);
    return;
  }
  const manifestId = `uppsc_${frag.replace("{year}", String(plan.year))}`;
  const path = join(PARSED_DIR, `pyq_${manifestId}.json`);
  if (!existsSync(path)) {
    report.warn(`parsed artifact not found (${path}) — DB updated, but a future pyq:load would revert Hindi; re-render/re-run overlay after any reload`);
    return;
  }
  const j = JSON.parse(await readFile(path, "utf8")) as {
    questions: { external_id: string; stem_i18n: any; options_i18n: any; meta: any }[];
  };
  const byExt = new Map(plan.accepted.map((a) => [a.external_id, a]));
  let n = 0;
  for (const q of j.questions) {
    const a = byExt.get(q.external_id);
    if (!a) continue;
    q.stem_i18n = { ...(q.stem_i18n ?? {}), hi: a.new_stem_hi };
    const hiByKey = new Map(a.options.map((o) => [o.key.trim().toUpperCase(), o.new_hi]));
    q.options_i18n = (q.options_i18n ?? []).map((o: any) => {
      const nh = hiByKey.get(String(o.key).trim().toUpperCase());
      return nh == null ? o : { ...o, text_i18n: { ...(o.text_i18n ?? {}), hi: nh } };
    });
    q.meta = { ...(q.meta ?? {}), machine_translated: false, hindi_source: "source_extracted" };
    n++;
  }
  await writeFile(path, JSON.stringify(j, null, 1));
  report.ok(`parsed artifact synced: ${n} question(s) in ${path.replace(PARSED_DIR, "…/parsed")}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const paper = typeof args.paper === "string" ? args.paper : "";
  const year = Number(args.year);
  const chunksDir = typeof args.chunks === "string" ? args.chunks : "";
  const minStem = args["min-stem"] ? Number(args["min-stem"]) : 0.5;
  const minOpt = args["min-opt"] ? Number(args["min-opt"]) : 0.6;
  const apply = args.apply === true;
  if (!paper || !year || !chunksDir) throw new Error("Usage: --paper <CODE> --year <YYYY> --chunks <dir> [--apply] [--min-stem n] [--min-opt n]");

  report.section(`ingest:hindi-overlay ${paper} ${year} ${apply ? "(APPLY)" : "(plan)"}`);
  const [targets, candidates] = await Promise.all([loadTargets(paper, year), loadChunks(chunksDir)]);
  report.ok(`target rows (published mcq, machine_translated): ${targets.length}`);
  report.ok(`candidate extractions across chunks: ${candidates.length}`);

  const plan = buildPlan(paper, year, targets, candidates, minStem, minOpt);
  const planPath = join(chunksDir, "plan.json");
  await writeFile(planPath, JSON.stringify(plan, null, 1));

  report.section("Plan summary");
  report.ok(`accepted (source Hindi validated): ${plan.accepted.length}`);
  report.warn(`rejected (kept machine_translated): ${plan.rejected.length}`);
  if (plan.rejected.length) for (const r of plan.rejected) report.step(`  q${r.q_no}: ${r.reason}`);
  report.warn(`no extraction found: ${plan.no_extraction.length}${plan.no_extraction.length ? ` [${plan.no_extraction.join(",")}]` : ""}`);
  const singleRead = plan.accepted.filter((a) => a.reads < 2).length;
  report.step(`  double-read verified: ${plan.accepted.length - singleRead}, single-read: ${singleRead}`);
  report.ok(`plan written: ${planPath}`);

  if (apply) {
    report.section("Applying");
    await applyPlan(plan);
  } else {
    report.step("(plan only — re-run with --apply to write)");
  }
}

main().catch((err) => {
  console.error("\ningest:hindi-overlay failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
