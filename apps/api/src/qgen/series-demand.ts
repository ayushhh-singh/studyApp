/**
 * Series-aware generation demand — the `--series <slug>` mode
 * docs/test-series-design.md §6.6 recommends and never built.
 *
 * WHY THIS EXISTS: `topup.ts`'s `FRESH_MCQ_FLOOR`/`FRESH_DESCRIPTIVE_FLOOR` run
 * uniformly across every leaf in a stage — they have no idea which topics an
 * actual scheduled `test_series_entries` row draws from. Measured 2026-08-19:
 * the uniform floor was asking for ~200 fresh CSAT questions per exam, when the
 * REAL scheduled demand is ~30 (uppsc's one CSAT full-length entry) and ZERO
 * (upsc has no CSAT series at all — `upsc-prelims-2027`'s `paper_scope` is
 * `UPSC_PRE_GS1`, so no entry's `node_targets` ever names a CSAT node).
 *
 * WHAT MAKES THIS BUILDABLE WITHOUT A SCHEMA CHANGE: every `test_series_entries`
 * row already stores enough for topup to reuse — but it's a SNAPSHOT copy, not
 * the source of truth (`services/test-series.ts` writes it for display/audit at
 * series-creation time). The actual source is the calendar JSON file
 * (`series/calendar.ts`'s `loadCalendar`), which `series/build.ts` re-reads on
 * EVERY assembly run. This module reads the SAME file the SAME way, so there is
 * no risk of drifting from what `series:build` will actually assemble.
 *
 * SCOPE: an entry is "qualifying" — worth generating for now — when it (a) has
 * not been assembled yet (`test_id is null`; once assembled its pool is already
 * spent/backfilled, generating more for it now helps nothing), (b) opens within
 * the lookahead window, and (c) declares a nonzero `composition.qgen` (a
 * current_affairs or state_special entry is qgen:0 by convention — §6.2 — so
 * this filter alone is enough; no entry_kind special-casing needed).
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { loadCalendar, istToUtc, type SeriesEntrySpec } from "../series/calendar.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear } from "../lib/weightage.js";
import { loadNodeContext, type GeneratePlan } from "./generate.js";

// This module deliberately imports NOTHING from `topup.ts` — it is a leaf that
// file imports FROM (like `on-demand-reserve.ts`), and importing the shared
// MAX_PER_NODE clamp back from `topup.ts` would make the two files circularly
// dependent. `seriesShortfallsFor` takes the clamp as a caller-supplied
// PARAMETER instead, so `topup.ts`'s `runSeriesTopup` passes its own
// `MAX_PER_NODE` in without either file needing to import from the other.

/** `.in()` chunk size — a long URL fails outright (this repo's own repeated `.in()` gotcha). */
const IN_CHUNK = 100;

interface LeafRow {
  id: string;
  path: string;
  title_i18n: unknown;
}

/**
 * Leaves of one paper (depth>=1, no children — the same definition
 * `topup.ts`'s `freshTargetsFor` uses), each with its recency-weighted PYQ
 * hotness. Paged for the same reason every other read in this pipeline is: a
 * truncated node list silently drops leaves, which reads exactly like "already
 * covered".
 */
async function paperLeaves(paperCode: string): Promise<{ leaves: LeafRow[]; hotOf: Map<string, number> }> {
  const rows = await selectAll<LeafRow & { parent_id: string | null; depth: number }>(() =>
    supabase()
      .from("syllabus_nodes")
      .select("id, path, title_i18n, parent_id, depth")
      .eq("paper_code", paperCode)
      .order("id", { ascending: true }),
  );
  const hasChild = new Set(rows.map((r) => r.parent_id).filter((p): p is string => !!p));
  const leaves = rows.filter((r) => r.depth >= 1 && !hasChild.has(r.id));

  const weightage = await loadNodeWeightage();
  const currentYear = currentExamYear();
  const hotOf = new Map<string, number>();
  for (const l of leaves) {
    const w = weightage.get(l.id);
    hotOf.set(l.id, w ? hotnessRaw(w.byYear, currentYear) : 0);
  }
  return { leaves, hotOf };
}

/**
 * Leaves matched by an entry's `node_targets` — `[]` means the whole paper.
 * PURE. Mirrors `series/build.ts`'s `buildAxis` matching rule verbatim (a
 * prefix matches itself and its descendants), because the two must agree: this
 * decides what topup GENERATES, that decides what an assembled test actually
 * DRAWS FROM, and a mismatch between the two would mean topping up the wrong
 * topic.
 */
export function matchingLeaves<T extends { path: string }>(leaves: readonly T[], targets: readonly string[]): T[] {
  if (targets.length === 0) return [...leaves];
  return leaves.filter((l) => targets.some((t) => l.path === t || l.path.startsWith(`${t}/`)));
}

/**
 * PURE: distribute `count` across `leafHot` (leafId -> hotness) proportionally
 * by hotness share, equal split when every hotness is 0 (mirrors
 * `topup.ts`'s `scaledFloor`'s own `maxHot <= 0` fallback).
 *
 * ⚑ LARGEST-REMAINDER, not plain `Math.round` per leaf — mirrors
 * `series/build.ts`'s `sliceTargets` for the identical reason. A per-leaf round
 * can silently lose the WHOLE `count` to rounding, not just drift by a unit or
 * two: a real entry's qgen share (often just 2-6 questions for a sectional)
 * spread across a CSAT-sized 9-leaf set with no dominant hotness rounds EVERY
 * leaf's raw share down to 0, so the entry's demand vanishes with nothing
 * generated anywhere and no error — the exact silent-data-loss shape this
 * repo's own dedup/embedding-cap incidents keep finding elsewhere. Flooring
 * each share then handing the leftover, one unit at a time, to the leaves with
 * the largest fractional remainder makes the output ALWAYS sum to exactly
 * `count` (when `count>0` and the map is non-empty), while the integer part
 * still tracks hotness proportionally.
 */
export function distributeByHotness(count: number, leafHot: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (count <= 0 || leafHot.size === 0) return out;
  const totalHot = [...leafHot.values()].reduce((s, h) => s + h, 0);

  const ids = [...leafHot.keys()];
  const exact = new Map(ids.map((id) => [id, totalHot > 0 ? (count * leafHot.get(id)!) / totalHot : count / ids.length]));
  const floors = new Map(ids.map((id) => [id, Math.floor(exact.get(id)!)]));
  let rem = count - [...floors.values()].reduce((s, f) => s + f, 0);

  const byRemainderDesc = [...ids].sort((a, b) => exact.get(b)! - floors.get(b)! - (exact.get(a)! - floors.get(a)!));
  for (const id of byRemainderDesc) {
    if (rem <= 0) break;
    floors.set(id, floors.get(id)! + 1);
    rem -= 1;
  }

  for (const [id, amt] of floors) {
    if (amt > 0) out.set(id, amt);
  }
  return out;
}

interface QualifyingEntry {
  spec: SeriesEntrySpec;
}

/**
 * Entries from the named series' calendar that still need their qgen slice
 * filled: unassembled, opening within the window, and asking for a nonzero
 * qgen share. `examCode` is taken from the calendar itself, never a caller
 * parameter — the calendar file IS the exam this series belongs to, so there is
 * nothing to default and nothing to get wrong (M24 is moot here by construction,
 * not by discipline).
 */
async function qualifyingEntries(
  seriesSlug: string,
  lookaheadDays: number,
  log: (msg: string) => void,
): Promise<{ examCode: string; entries: QualifyingEntry[] }> {
  const cal = loadCalendar(seriesSlug); // throws loudly on an unknown slug or a malformed calendar file

  const { data: seriesRow, error: seriesErr } = await supabase()
    .from("test_series")
    .select("id, status")
    .eq("slug", seriesSlug)
    .maybeSingle();
  if (seriesErr) throw new Error(`test_series lookup failed for "${seriesSlug}": ${seriesErr.message}`);
  if (!seriesRow) {
    log(`series "${seriesSlug}" has a calendar file but no test_series row yet — run \`pnpm series:build --series ${seriesSlug}\` first.`);
    return { examCode: cal.exam_code, entries: [] };
  }
  if (seriesRow.status !== "published") {
    log(`series "${seriesSlug}" is "${seriesRow.status}", not published — skipping (a draft series has no live demand yet).`);
    return { examCode: cal.exam_code, entries: [] };
  }

  // Which sequence numbers are already assembled (test_id set)? Their pool was
  // already drawn (or backfilled) at build time — generating more for them now
  // helps nothing and would double-count against approved supply that a FUTURE
  // (still-unassembled) entry also needs.
  const assembled = new Set<number>();
  const entryRows = await selectAll<{ sequence_no: number; test_id: string | null }>(() =>
    supabase().from("test_series_entries").select("sequence_no, test_id").eq("series_id", seriesRow.id).order("sequence_no", { ascending: true }),
  );
  for (const r of entryRows) if (r.test_id) assembled.add(r.sequence_no);

  // No lower bound on `opensAt` — an entry that already opened and is STILL
  // unassembled is even more urgent than an upcoming one, so it is always
  // included rather than requiring a caller to widen the window backwards to
  // catch it. But that also means it is otherwise INDISTINGUISHABLE from a
  // normal upcoming entry in the log, which would quietly bury a real
  // operational problem (nobody ran `series:build` before this entry's own
  // opening date) inside an ordinary-looking run. Flagged loudly here instead.
  const now = Date.now();
  const cutoff = now + lookaheadDays * 24 * 60 * 60 * 1000;
  const entries: QualifyingEntry[] = [];
  for (const e of cal.entries) {
    if (assembled.has(e.sequence_no)) continue;
    if (e.composition.qgen === 0) continue; // nothing to generate for this entry
    const opensAt = istToUtc(e.opens_on, cal.opens_time_ist).getTime();
    if (opensAt > cutoff) continue; // outside the lookahead window
    if (opensAt <= now) {
      const overdueDays = Math.floor((now - opensAt) / (24 * 60 * 60 * 1000));
      log(
        `  ⚠ series "${seriesSlug}" entry #${e.sequence_no} opened ${e.opens_on} (${overdueDays}d ago) and is STILL ` +
          `unassembled — \`series:build\` likely has not run for it yet.`,
      );
    }
    entries.push({ spec: e });
  }
  return { examCode: cal.exam_code, entries };
}

/**
 * Generation plans for one series' upcoming, unassembled entries — the
 * `--series <slug>` mode. Returns `[]` (never throws) for a draft or
 * not-yet-built series, or when nothing in the window needs qgen; throws on a
 * genuinely malformed calendar (unknown slug, or `node_targets` matching no
 * real leaf — the same "fail loud on a config typo" rule `series/build.ts`'s
 * `buildAxis` already applies, appropriate here because this is an explicitly
 * human-invoked tool, not a step inside the always-on nightly cron).
 */
export async function seriesShortfallsFor(opts: {
  seriesSlug: string;
  lookaheadDays: number;
  /**
   * The same per-node ceiling `topup.ts`'s uniform passes apply (`MAX_PER_NODE`)
   * — taken as a PARAMETER, not imported, so this module stays a clean leaf
   * with no dependency back on `topup.ts` (see the header note on why). Applied
   * HERE, before the log line, rather than by the caller afterwards: the
   * uniform pipeline's `shortfallsFor`/`freshShortfallsFor` clamp before they
   * log too, and a caller-side clamp would make this function's own "→
   * generate N" line disagree with what actually gets generated — exactly the
   * confusing two-different-numbers-for-one-node output an earlier version of
   * this function shipped with, found by the 2026-08-22 edge-case audit.
   */
  maxPerNode: number;
  log: (msg: string) => void;
}): Promise<GeneratePlan[]> {
  const { seriesSlug, lookaheadDays, maxPerNode, log } = opts;
  const { examCode, entries } = await qualifyingEntries(seriesSlug, lookaheadDays, log);
  log(`${seriesSlug} (${examCode}): ${entries.length} unassembled entr${entries.length === 1 ? "y" : "ies"} with a qgen share open${entries.length === 1 ? "s" : ""} within ${lookaheadDays}d.`);
  if (entries.length === 0) return [];

  // Group by (paper_code, question_type) — the leaf set and the pool are both
  // per-paper, and a series legitimately mixes papers (e.g. uppsc-prelims-2026
  // is mostly PRE_GS1 sectionals plus one PRE_CSAT full-length).
  const byPaperKind = new Map<string, QualifyingEntry[]>();
  for (const e of entries) {
    const key = `${e.spec.paper_code}::${e.spec.question_type}`;
    (byPaperKind.get(key) ?? byPaperKind.set(key, []).get(key)!).push(e);
  }

  const demandByLeaf = new Map<string, number>();
  const kindOfLeaf = new Map<string, "mcq" | "descriptive">();

  for (const [key, group] of byPaperKind) {
    const sep = key.lastIndexOf("::");
    const paperCode = key.slice(0, sep);
    const questionType = key.slice(sep + 2) as "mcq" | "descriptive";
    const { leaves, hotOf } = await paperLeaves(paperCode);
    if (leaves.length === 0) {
      throw new Error(
        `series "${seriesSlug}": paper "${paperCode}" has no syllabus leaves — a current_affairs entry should name ` +
          `the GS paper its questions map into (composition.ca=100, composition.qgen=0), not a real target here.`,
      );
    }
    for (const e of group) {
      const targetLeaves = matchingLeaves(leaves, e.spec.node_targets);
      if (targetLeaves.length === 0) {
        throw new Error(
          `series "${seriesSlug}" entry #${e.spec.sequence_no}: node_targets [${e.spec.node_targets.join(", ")}] ` +
            `match no leaf in ${paperCode} — a path prefix is stale (paths are slugs like "polity/constitution").`,
        );
      }
      const qgenNeeded = Math.round((e.spec.question_count * e.spec.composition.qgen) / 100);
      if (qgenNeeded <= 0) continue;
      const leafHot = new Map(targetLeaves.map((l) => [l.id, hotOf.get(l.id) ?? 0]));
      for (const [leafId, amt] of distributeByHotness(qgenNeeded, leafHot)) {
        demandByLeaf.set(leafId, (demandByLeaf.get(leafId) ?? 0) + amt);
        kindOfLeaf.set(leafId, questionType);
      }
    }
  }
  if (demandByLeaf.size === 0) return [];

  // Diff against currently-APPROVED generated supply — the identical
  // "generated + approved" definition `freshTargetsFor` uses, so this pass
  // never asks for content that is already there and never counts something
  // still sitting in needs_review as if it were usable.
  const leafIds = [...demandByLeaf.keys()];
  const approvedByLeaf = new Map<string, number>();
  for (let i = 0; i < leafIds.length; i += IN_CHUNK) {
    const chunk = leafIds.slice(i, i + IN_CHUNK);
    const rows = await selectAll<{ syllabus_node_id: string }>(() =>
      supabase()
        .from("questions")
        .select("syllabus_node_id")
        .eq("exam_code", examCode)
        .eq("source", "generated")
        .eq("review_state", "approved")
        .in("syllabus_node_id", chunk)
        .not("syllabus_node_id", "is", null),
    );
    for (const r of rows) approvedByLeaf.set(r.syllabus_node_id, (approvedByLeaf.get(r.syllabus_node_id) ?? 0) + 1);
  }

  const plans: GeneratePlan[] = [];
  for (const [leafId, wanted] of demandByLeaf) {
    const have = approvedByLeaf.get(leafId) ?? 0;
    const shortfall = Math.min(maxPerNode, Math.max(0, wanted - have));
    if (shortfall <= 0) continue;
    const node = await loadNodeContext(leafId);
    log(`  ↳ series "${seriesSlug}": "${(node.title_i18n as { en: string }).en}" wanted=${wanted} approved=${have} → generate ${shortfall}`);
    plans.push({ node, count: shortfall, kind: kindOfLeaf.get(leafId)! });
  }
  return plans;
}
