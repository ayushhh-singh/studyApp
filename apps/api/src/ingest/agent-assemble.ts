/**
 * ingest:assemble — deterministic (NO LLM, no API cost) bridge from a subagent's
 * raw extraction JSON to the parsed/pyq_<id>.json format that ingest:pyq:load
 * consumes. The LLM-heavy work (reading the PDF, bilingual extraction, blind
 * solve) is done by a Claude Code subagent to avoid app-API spend; this script
 * just plumbs its output into the pipeline schema + the blind-resolve gate.
 *
 *   pnpm ingest:assemble --id uppsc_prelims_2022_gs1 \
 *       --raw <scratchpad>/extract_2022_gs1.json \
 *       [--keyjson <scratchpad>/key_2022_gs1.json]   (official q_no→answer map, if obtained)
 *
 * Raw item shape (subagent output):
 *   { q_no, stem_en, stem_hi, options:[{key,en,hi}], blind_answer, confidence, defective?, note? }
 * Optional key map: { "1":"A", "2":"C", ... }  (official answer key, series-aligned)
 *
 * Publish gate (applied later by pyq-load's decideReview, which reads meta.blind_resolve):
 *   - official key present + blind agrees      → status "ok"      → auto-publish eligible
 *   - official key present + blind disagrees    → status "flagged" → Review Queue (key kept)
 *   - defective question                        → status "flagged" → Review Queue
 *   - no official key                           → status "no_key"  → Review Queue (blind answer shown)
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  classifyPyqId,
  examLabel,
  paperByCode,
  parseArgs,
  report,
  PARSED_DIR,
  ensureParsedDir,
} from "./_shared.js";

interface RawItem {
  q_no: number;
  stem_en: string;
  stem_hi: string;
  options: { key: string; en: string; hi: string }[];
  blind_answer: string;
  confidence?: string;
  defective?: boolean;
  note?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const id = typeof args.id === "string" ? args.id : null;
  const rawPath = typeof args.raw === "string" ? args.raw : null;
  if (!id || !rawPath) throw new Error("Provide --id <manifest_id> and --raw <extraction.json>.");

  const cls = classifyPyqId(id);
  if (!cls) throw new Error(`Cannot classify paper from id ${id}`);
  const paper = paperByCode(cls.paperCode);
  if (!paper) throw new Error(`Unknown paper_code ${cls.paperCode}`);
  if (cls.stage !== "prelims") throw new Error("ingest:assemble is for prelims MCQ papers only.");

  const raw = JSON.parse(await readFile(rawPath, "utf8")) as RawItem[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`No items in ${rawPath}`);

  let keyMap: Record<string, string> | null = null;
  if (typeof args.keyjson === "string") {
    keyMap = JSON.parse(await readFile(args.keyjson, "utf8")) as Record<string, string>;
  }

  report.section(`ingest:assemble ${id} (${raw.length} raw items${keyMap ? ", with official key" : ", no key"})`);

  let ok = 0;
  let flagged = 0;
  let noKey = 0;
  const questions = raw.map((r) => {
    const blind = (r.blind_answer ?? "").trim().toUpperCase();
    const official = keyMap ? (keyMap[String(r.q_no)] ?? "").trim().toUpperCase() : "";
    const meta: Record<string, unknown> = {
      source_ref: `${id}#q${r.q_no}`,
      extracted_by: "subagent_visual",
      blind_confidence: r.confidence ?? null,
    };
    if (r.defective) meta.defective_question = { note: r.note ?? "" };

    let correct = blind || null;
    let blindResolve: Record<string, unknown>;
    if (official) {
      meta.official_answer = official;
      meta.answer_key_verified = true;
      correct = official; // official key is ground truth
      if (r.defective) {
        blindResolve = { status: "flagged", reason: "defective_question", chosen_key: blind, stored_key: official, note: r.note ?? "" };
        flagged++;
      } else if (blind === official) {
        blindResolve = { status: "ok", chosen_key: blind, stored_key: official, agrees: true, confidence: r.confidence ?? null };
        ok++;
      } else {
        meta.answer_key_mismatch = { extracted: blind, official };
        blindResolve = { status: "flagged", reason: "blind_vs_key_disagreement", chosen_key: blind, stored_key: official };
        flagged++;
      }
    } else {
      // No official key: blind solve proposes the answer; publishes only via review.
      blindResolve = r.defective
        ? { status: "flagged", reason: "defective_question", proposed_key: blind, note: r.note ?? "" }
        : { status: "no_key", proposed_key: blind, confidence: r.confidence ?? null };
      if (r.defective) flagged++;
      else noKey++;
    }
    meta.blind_resolve = blindResolve;

    return {
      external_id: `pyq:${id}:q${r.q_no}`,
      type: "mcq" as const,
      stage: cls.stage,
      exam_code: cls.examCode,
      exam_label_i18n: examLabel(cls.examCode, cls.stage),
      source_kind: "official" as const,
      source_ref: id,
      out_of_syllabus: false,
      paper_code: cls.paperCode,
      year: cls.year,
      q_no: r.q_no,
      stem_i18n: { hi: (r.stem_hi ?? "").trim(), en: (r.stem_en ?? "").trim() },
      options_i18n: (r.options ?? []).map((o) => ({
        key: (o.key ?? "").trim().toUpperCase(),
        text_i18n: { hi: (o.hi ?? "").trim(), en: (o.en ?? "").trim() },
      })),
      correct_option_key: correct,
      explanation_i18n: null,
      difficulty: "medium" as const,
      marks: null,
      word_limit: null,
      syllabus_paper_code: cls.paperCode,
      syllabus_path: null, // classified in a later step (kept out of the extraction subagent for quality)
      is_bilingual_complete: !!(r.stem_en && r.stem_hi && (r.options ?? []).length >= 2 && correct),
      meta,
    };
  });

  await ensureParsedDir();
  const outPath = join(PARSED_DIR, `pyq_${id}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        source: { manifest_id: id, ...cls, extracted_by: "subagent_visual" },
        summary: {
          questions: questions.length,
          blind_resolve: { ok, flagged, no_key: noKey },
          has_official_key: !!keyMap,
        },
        questions,
      },
      null,
      2,
    ),
  );

  // --- Completeness gate: the subagents' one weak spot vs the schema-enforced
  // app pipeline is dropped/incomplete questions. Surface gaps LOUDLY so they're
  // re-extracted before load, never silently missing.
  const qNos = questions.map((q) => q.q_no).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const maxQ = qNos.length ? qNos[qNos.length - 1] : 0;
  const present = new Set(qNos);
  const gaps: number[] = [];
  for (let i = 1; i <= maxQ; i++) if (!present.has(i)) gaps.push(i);
  const incomplete = questions.filter(
    (q) => !q.stem_i18n.en || !q.stem_i18n.hi || (q.options_i18n?.length ?? 0) < 2 || !q.correct_option_key,
  );
  const dupes = qNos.filter((n, i) => qNos[i - 1] === n);

  report.ok(`wrote ${outPath.replace(/^.*content-raw/, "content-raw")}`);
  console.log(`  questions              ${questions.length}  (q_no 1..${maxQ})`);
  console.log(`  blind ok (agree key)   ${ok}`);
  console.log(`  flagged (→ review)     ${flagged}`);
  console.log(`  no-key (→ review)      ${noKey}`);
  report.section("Completeness gate");
  if (gaps.length === 0 && incomplete.length === 0 && dupes.length === 0) {
    report.ok(`COMPLETE — no q_no gaps, no incomplete questions, no duplicate q_no`);
  } else {
    if (gaps.length) report.warn(`MISSING q_no (re-extract these): ${gaps.join(", ")}`);
    if (dupes.length) report.warn(`DUPLICATE q_no: ${[...new Set(dupes)].join(", ")}`);
    if (incomplete.length)
      report.warn(`INCOMPLETE (missing option/stem/key) q_no: ${incomplete.map((q) => q.q_no).join(", ")}`);
    report.warn(`→ fix the extraction JSON (re-run the gaps) and re-assemble before loading.`);
  }
  report.step("next: pnpm ingest:pyq:load --id " + id);
}

main().catch((err) => {
  console.error("\ningest:assemble failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
