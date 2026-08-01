/**
 * ADDITIVELY map a SECOND exam onto the EXISTING current-affairs corpus —
 * triage-only, union-only, content-untouched. `docs/OUTSTANDING.md` §8c **M48**.
 *
 * For every published item the target exam does not yet claim, this runs THAT
 * EXAM'S OWN triage (the same `triageParams` / pre-filter / `normalizeTriage`
 * path the live pipeline uses, via the Message Batches API at 50% off) and, if
 * the item clears that exam's relevance gate, UNIONs the exam code and the newly
 * mapped nodes onto the row's STORED arrays. Nothing else is ever written.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A NEW TOOL AND NOT A FLAG ON `ca:backfill`
 * ---------------------------------------------------------------------------
 * `ca:backfill --exam <code>` looks like it should already do this. It cannot,
 * for three independent and individually-SILENT reasons (all measured live
 * 2026-08-01; the full write-up is in `./backfill.ts`'s header and M48):
 *
 *  1. SELECTION. It reads only `prelims_relevance IS NULL` — 107 of 2,104
 *     published items. The other 1,997 are unreachable whatever `--exam` says.
 *  2. REPLACEMENT, NOT UNION. Its updates write `exam_codes:
 *     merged.itemExamCodes` and `syllabus_node_ids: triage.syllabus_node_ids` —
 *     THIS RUN'S scopes only. It never reads the row, so it cannot union with
 *     what is already there; scoping it to one exam makes every processed row
 *     LOSE the other exams' codes and mappings.
 *  3. CONTENT REWRITE. Its enrich branch rewrites `title_i18n`, `summary_i18n`,
 *     `prelims_facts`, `mains_brief`, `possible_questions`, `node_significance`,
 *     `category`, `gs_papers`, `is_up_specific` and `status` — and sets an item
 *     the target exam gates out to `archived`, pulling a good live item out of
 *     the LIVE exam's feed.
 *
 * Those are not bugs to fix in place: (2) and (3) are exactly what a RE-SCORING
 * tool is supposed to do. Widening is a different operation, so it gets a
 * different tool whose write path is incapable of the other one's behaviour.
 *
 * ---------------------------------------------------------------------------
 * THE SAFETY PROPERTIES, AND HOW EACH IS ENFORCED RATHER THAN INTENDED
 * ---------------------------------------------------------------------------
 *  (a) NO FORBIDDEN COLUMN CAN BE WRITTEN — enforced twice, and neither is a
 *      comment or a convention. `WidenUpdate` declares every column M48 names
 *      as `?: never`, so naming one is a COMPILE error even through a widened
 *      variable; and `assertWidenPayload` re-checks the actual key set at
 *      runtime, so a cast cannot slip past either. The single `.update()` call
 *      in this module takes a `WidenUpdate` and nothing else.
 *  (b) UNION, NEVER REPLACE — `buildWidenUpdate` is pure and takes the row's
 *      STORED arrays as input, so it cannot produce a payload that drops a
 *      pre-existing code or node id. It is re-read immediately before the write
 *      (not reused from selection time), so a concurrent `ca:run` that widened
 *      the row in the meantime is unioned WITH, not over.
 *  (c) A BELOW-GATE ITEM PRODUCES NO WRITE AT ALL — not an archive, not a
 *      downgrade, not a status touch. The gate is checked before the payload is
 *      built, and the item is simply skipped.
 *  (d) ALREADY-WIDENED IS A NO-OP — such rows are excluded at SELECTION (so a
 *      re-run costs nothing rather than re-triaging), and `buildWidenUpdate`
 *      independently returns `null` when the union changes nothing, so a row
 *      widened between selection and write is still not rewritten.
 *
 * ⚑ NEVER DELETES. There is no delete statement in this module and there must
 * never be one; the corpus is shared production content.
 */
import { supabase } from "../lib/supabase.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT, runBatch, structuredParams, type BatchRequest } from "../lib/anthropic.js";
import { normalizeTriage, triageParams, type SyllabusCandidate, type TriageResult } from "./prompts.js";
import { RELEVANCE_GATE } from "./exam-fanout.js";
import { loadSyllabusCandidates } from "./syllabus-candidates.js";
import { CandidatePrefilter } from "./candidate-prefilter.js";
import { selectAll } from "../lib/paginate.js";

/** Items per triage batch + per budget checkpoint. Matches `ca:backfill`. */
const CHUNK_SIZE = 40;

/**
 * Measured token sizes for the cost projection — NOT guesses.
 *
 * `triageInput` is the post-pre-filter measurement (top-150 of the tree) that
 * corrected `ca:backfill`'s original 2300, which under-projected badly enough to
 * overshoot its own `--max-usd`. Cross-checked against the M48 feasibility
 * probe: a real 50-item UPSC triage batch billed $0.1867 (~$0.0037/item), which
 * this projection reproduces to within a few percent.
 */
const EST = { triageInput: 6100, triageOutput: 260 } as const;

/** Per-item Batch-API triage cost. One call per item — this tool never fans out. */
export function estimateTriageCostPerItem(): number {
  return estimateCostUsd(MODELS.haiku, EST.triageInput, EST.triageOutput) * BATCH_DISCOUNT;
}

// ---------------------------------------------------------------------------
// (a) THE WRITE PAYLOAD — structurally restricted, not restricted by convention
// ---------------------------------------------------------------------------

/**
 * The ONLY two columns this tool may write. `updated_at` is excluded on purpose:
 * it is maintained by the `trg_current_affairs_updated_at` trigger (migration
 * 0009), so naming it here would be a second, competing writer.
 */
export const WIDEN_UPDATE_COLUMNS = ["exam_codes", "syllabus_node_ids"] as const;

/**
 * Every column this tool must NEVER write. Exactly M48's list, plus the two
 * relevance scores and `date`/`link`: the scores on the row are the MERGED
 * cross-exam verdict, so overwriting them with one exam's opinion would be the
 * same replacement bug in a different column.
 */
export type ForbiddenWidenColumn =
  | "title_i18n"
  | "summary_i18n"
  | "detail_i18n"
  | "prelims_facts"
  | "mains_brief"
  | "possible_questions"
  | "node_significance"
  | "category"
  | "gs_papers"
  | "is_up_specific"
  | "status"
  | "content_hash"
  | "mcq_question_ids"
  | "prelims_relevance"
  | "mains_relevance"
  | "date"
  | "link"
  | "source"
  | "updated_at";

/**
 * The update payload shape.
 *
 * The `?: never` half is what makes property (a) STRUCTURAL. `{ exam_codes,
 * syllabus_node_ids, status: "archived" }` does not merely violate a rule — it
 * fails to typecheck, with the offending column named, and it keeps failing if
 * the literal is first assigned to a wider variable (excess-property checking
 * alone would not catch that; `?: never` does).
 */
export type WidenUpdate = {
  exam_codes: string[];
  syllabus_node_ids: string[];
} & { [K in ForbiddenWidenColumn]?: never };

/**
 * Runtime backstop for (a): the payload's ACTUAL key set must be exactly the two
 * allowed columns. Belt and braces on purpose — the type is erased at runtime,
 * so a `as WidenUpdate` cast or a payload built by spreading an untyped object
 * would otherwise reach `.update()` unchecked. This writes to live production
 * content; one of the two guards being redundant is the point.
 */
export function assertWidenPayload(payload: Record<string, unknown>): void {
  const keys = Object.keys(payload);
  const allowed = new Set<string>(WIDEN_UPDATE_COLUMNS);
  const illegal = keys.filter((k) => !allowed.has(k));
  if (illegal.length > 0) {
    throw new Error(
      `ca:widen-exam refuses to write ${illegal.map((k) => `"${k}"`).join(", ")}: this tool may only write ` +
        `${WIDEN_UPDATE_COLUMNS.join(" + ")}. Rewriting any other column is ca:backfill's job, not this one (M48).`,
    );
  }
  const missing = WIDEN_UPDATE_COLUMNS.filter((c) => !keys.includes(c));
  if (missing.length > 0) {
    throw new Error(`ca:widen-exam payload is missing ${missing.join(", ")} — a partial payload is never intended.`);
  }
}

/** What a row currently holds, read fresh immediately before the write. */
export interface StoredScope {
  examCodes: readonly string[];
  syllabusNodeIds: readonly string[];
}

/**
 * (b) + (d): union the target exam and its newly mapped nodes onto the STORED
 * arrays. Pure — no DB, no clock, no model — so both properties are unit-provable.
 *
 * Returns `null` when the union changes nothing, which is what makes a re-run
 * (or a row widened concurrently) a genuine no-op rather than a same-value write.
 *
 * Order is APPEND-ONLY: stored values keep their positions and new ones follow.
 * That matters — `exam_codes[0]` records the exam whose voice the stored prose
 * was written in (`mergeExamTriages`), and this tool does not rewrite prose, so
 * it must not disturb that marker.
 */
export function buildWidenUpdate(
  stored: StoredScope,
  targetExam: string,
  newNodeIds: readonly string[],
): WidenUpdate | null {
  const examCodes = [...stored.examCodes];
  if (!examCodes.includes(targetExam)) examCodes.push(targetExam);

  const nodeIds = [...stored.syllabusNodeIds];
  const seen = new Set(nodeIds);
  for (const id of newNodeIds) {
    if (!seen.has(id)) {
      seen.add(id);
      nodeIds.push(id);
    }
  }

  const unchanged =
    examCodes.length === stored.examCodes.length && nodeIds.length === stored.syllabusNodeIds.length;
  if (unchanged) return null;

  return { exam_codes: examCodes, syllabus_node_ids: nodeIds };
}

/** (c): does this exam's own verdict clear the gate? */
export function clearsGate(triage: TriageResult): boolean {
  return Math.max(triage.prelims_relevance, triage.mains_relevance) >= RELEVANCE_GATE;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface WidenItem {
  id: string;
  title: string;
  snippet: string;
  is_up_specific: boolean;
}

/** `text[] @> {code}` — the PostgREST "contains" filter for the exclusion below. */
const containsExam = (examCode: string) => `{${examCode}}`;

async function countPublished(filter?: { alreadyWidened: string }): Promise<number> {
  let q = supabase()
    .from("current_affairs_items")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");
  if (filter) q = q.contains("exam_codes", containsExam(filter.alreadyWidened));
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * PUBLISHED items the target exam does not already claim — the widening
 * candidates, newest first.
 *
 * Deliberately NOT `prelims_relevance IS NULL` (that is `ca:backfill`'s
 * selection and reaches only 5% of the corpus), and deliberately EXCLUDING rows
 * already carrying the code so a re-run is cheap as well as idempotent (d).
 *
 * Paged via `selectAll` — an unranged select truncates at PostgREST's 1000-row
 * cap in silence, and the corpus is already twice that.
 */
export async function loadWidenCandidates(examCode: string, limit?: number): Promise<WidenItem[]> {
  const rows = await selectAll<Record<string, unknown>>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, title_i18n, summary_i18n, detail_i18n, is_up_specific")
      .eq("status", "published")
      .not("exam_codes", "cs", containsExam(examCode))
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );
  const items = rows.map((r) => {
    const title = (r.title_i18n as { en?: string })?.en ?? "";
    const summary = (r.summary_i18n as { en?: string } | null)?.en ?? "";
    const legacy =
      (r.detail_i18n as { what_happened_i18n?: { en?: string } } | null)?.what_happened_i18n?.en ?? "";
    return {
      id: r.id as string,
      title,
      snippet: [summary, legacy].filter(Boolean).join(" ").slice(0, 1200),
      is_up_specific: !!r.is_up_specific,
    };
  });
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

// ---------------------------------------------------------------------------
// Plan (dry run) — READ-ONLY, ZERO MODEL CALLS, ZERO SPEND
// ---------------------------------------------------------------------------

export interface WidenPlan {
  examCode: string;
  publishedTotal: number;
  /** Rows the exam already claims — skipped, and the reason a re-run is cheap. */
  alreadyWidened: number;
  /** Rows that would be triaged (after `--limit`). */
  targeted: number;
  /** Rows eligible but excluded by `--limit`. */
  deferredByLimit: number;
  estimatedCostUsd: number;
}

/**
 * The dry-run projection. Makes NO model call and NO embedding call, so it costs
 * nothing and can be run freely before authorising a write pass.
 */
export async function planWiden(examCode: string, limit?: number): Promise<WidenPlan> {
  const [publishedTotal, alreadyWidened] = await Promise.all([
    countPublished(),
    countPublished({ alreadyWidened: examCode }),
  ]);
  const eligible = publishedTotal - alreadyWidened;
  const targeted = typeof limit === "number" ? Math.min(limit, eligible) : eligible;
  return {
    examCode,
    publishedTotal,
    alreadyWidened,
    targeted,
    deferredByLimit: eligible - targeted,
    estimatedCostUsd: estimateTriageCostPerItem() * targeted,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface WidenRunResult {
  /** Rows whose arrays were actually unioned. */
  widened: number;
  /** Triaged, but this exam's verdict was below the gate → untouched. */
  belowGate: number;
  /** Triage came back unusable (truncated/failed) → untouched, retryable. */
  unusable: number;
  /** Union was already satisfied at write time → no statement issued. */
  noopAtWrite: number;
  /** Rows the exam already claimed at selection time (never triaged). */
  skippedAlreadyWidened: number;
  costUsd: number;
  stoppedForBudget: boolean;
  remaining: number;
}

type Log = (msg: string) => void;

/**
 * THE ONLY STATEMENT IN THIS MODULE THAT WRITES `current_affairs_items`.
 *
 * It accepts a `WidenUpdate` and nothing else, and re-asserts the key set at
 * runtime before issuing the update. Both halves of property (a) meet here.
 */
async function applyWiden(id: string, payload: WidenUpdate): Promise<void> {
  assertWidenPayload(payload as Record<string, unknown>);
  const { error } = await supabase().from("current_affairs_items").update(payload).eq("id", id);
  if (error) throw new Error(`ca:widen-exam: update failed for ${id}: ${error.message}`);
}

/** Re-read the row's stored scope arrays immediately before writing (b). */
async function readStoredScope(id: string): Promise<StoredScope | null> {
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("exam_codes, syllabus_node_ids")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    examCodes: (data.exam_codes as string[] | null) ?? [],
    syllabusNodeIds: (data.syllabus_node_ids as string[] | null) ?? [],
  };
}

export async function runWiden(opts: {
  examCode: string;
  maxUsd: number;
  limit?: number;
  log?: Log;
}): Promise<WidenRunResult> {
  const log = opts.log ?? (() => {});
  const { examCode } = opts;

  // ONE scope, always: this tool widens by exactly one exam per run, so triage
  // never fans out and one item costs exactly one call.
  const candidates = await loadSyllabusCandidates({ examCodes: [examCode] });
  if (candidates.length === 0) {
    throw new Error(
      `ca:widen-exam: exam "${examCode}" has no depth-1/2 syllabus nodes — there is nothing to map onto. ` +
        `Ingest its syllabus tree first.`,
    );
  }
  const prefilter = await CandidatePrefilter.create(candidates);

  const alreadyWidened = await countPublished({ alreadyWidened: examCode });
  const all = await loadWidenCandidates(examCode, opts.limit);

  const result: WidenRunResult = {
    widened: 0,
    belowGate: 0,
    unusable: 0,
    noopAtWrite: 0,
    skippedAlreadyWidened: alreadyWidened,
    costUsd: 0,
    stoppedForBudget: false,
    remaining: all.length,
  };

  log(
    `exam ${examCode}: ${all.length} published item(s) to triage; ` +
      `${alreadyWidened} already carry the code (skipped); budget cap $${opts.maxUsd.toFixed(2)}`,
  );
  log(
    `ADDITIVE ONLY: writes exam_codes + syllabus_node_ids as stored ∪ new. No content column, no status, ` +
      `no delete, no archive. A below-gate item is left completely untouched.`,
  );

  const chunkProjection = estimateTriageCostPerItem() * CHUNK_SIZE;

  for (let start = 0; start < all.length; start += CHUNK_SIZE) {
    if (result.costUsd + chunkProjection > opts.maxUsd) {
      result.stoppedForBudget = true;
      log(
        `stopping before chunk at ${start}: the next chunk would exceed the cap ` +
          `(spent $${result.costUsd.toFixed(4)} of $${opts.maxUsd.toFixed(2)})`,
      );
      break;
    }
    const chunk = all.slice(start, start + CHUNK_SIZE);
    log(`chunk ${Math.floor(start / CHUNK_SIZE) + 1}: triaging ${chunk.length} item(s) for ${examCode}...`);

    // Same embedding pre-filter as the live pipeline, batched one call per chunk.
    // `shown[i]` MUST be what `normalizeTriage` validates against — the full list
    // would accept ids the model was never offered.
    const shown = await prefilter.narrowMany(
      chunk.map((it) => ({ title: it.title, snippet: it.snippet })),
      (u) => (result.costUsd += u.costUsd),
    );

    const reqs: BatchRequest[] = chunk.map((it, i) => ({
      customId: `w_${i}`,
      params: structuredParams(
        triageParams({
          title: it.title,
          snippet: it.snippet,
          sourceIsUp: it.is_up_specific,
          candidates: shown[i],
          examCode,
        }),
      ),
      purpose: "ca_triage",
      examCode,
    }));
    const res = await runBatch(reqs, { onUsage: (u) => (result.costUsd += u.costUsd) });

    for (let i = 0; i < chunk.length; i++) {
      const r = res.get(`w_${i}`);
      if (!r?.ok) {
        result.unusable++;
        continue; // untouched → retried on a later run
      }
      let triage: TriageResult;
      try {
        triage = normalizeTriage(
          JSON.parse(r.text) as TriageResult,
          shown[i],
          chunk[i].is_up_specific,
          examCode,
        );
      } catch {
        result.unusable++;
        continue;
      }

      // (c) Below this exam's gate → NO write of any kind. Not archived, not
      // downgraded, not touched. The item simply is not this exam's.
      if (!clearsGate(triage)) {
        result.belowGate++;
        continue;
      }

      // (b) Union against what the row holds RIGHT NOW, not against a snapshot
      // taken before the batch — a concurrent `ca:run` may have widened it.
      const stored = await readStoredScope(chunk[i].id);
      if (!stored) {
        result.unusable++;
        continue;
      }
      const payload = buildWidenUpdate(stored, examCode, triage.syllabus_node_ids);
      if (!payload) {
        result.noopAtWrite++; // (d)
        continue;
      }
      await applyWiden(chunk[i].id, payload);
      result.widened++;
    }

    log(
      `chunk done — widened ${result.widened}, below gate ${result.belowGate}, ` +
        `no-op ${result.noopAtWrite}, unusable ${result.unusable}, spent $${result.costUsd.toFixed(4)}`,
    );
  }

  result.remaining =
    all.length - (result.widened + result.belowGate + result.noopAtWrite + result.unusable);
  return result;
}
