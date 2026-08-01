/**
 * Re-classify + re-enrich EVERY already-published current-affairs item under the
 * new exam-relevance model, via the Message Batches API (50% cheaper). The old
 * pipeline stored a flat summary with no relevance scores / prelims-vs-mains
 * split; this backfills the new triage scores + the two-lives structure onto
 * them, and archives any that no longer clear the gate.
 *
 * - Cost-capped by `CA_BACKFILL_MAX_USD` (or --max-usd). Stops cleanly when the
 *   next chunk would exceed the cap; the remaining items are picked up on the
 *   next run.
 * - Resumable: an item is "done" once its `prelims_relevance` is set (or it was
 *   archived), so a re-run only processes what's left — safe to interrupt.
 * - Progress logged per chunk.
 *
 * We re-use the item's OWN stored (own-words) title/summary as the model's
 * context — we no longer hold the original RSS snippet, and the stored summary
 * is already a clean paraphrase, so this stays within ToS.
 *
 * ---------------------------------------------------------------------------
 * ⚑ THIS TOOL RE-SCORES AND REWRITES. IT DOES NOT ADD.
 * ---------------------------------------------------------------------------
 * Read this before reaching for it to "give a second exam a mapping onto the
 * existing corpus" — it is the wrong tool for that, in three independent ways,
 * and each one is silent:
 *
 *  1. SELECTION. It only ever sees items with `prelims_relevance IS NULL` (see
 *     `loadItemsNeedingBackfill`) — i.e. the ones NEVER re-scored under the
 *     two-lives model. Measured 2026-08-01: 107 of 2,104 published items. The
 *     other 1,997 are invisible to it no matter what `--exam` says.
 *  2. REPLACEMENT, NOT UNION. Both update statements below write
 *     `exam_codes: merged.itemExamCodes` and `syllabus_node_ids:
 *     triage.syllabus_node_ids` — the merge of THIS RUN'S scopes only. Narrow
 *     the scope to one exam and every processed row LOSES the other exams'
 *     codes and node mappings. `mergeExamTriages` unions across the exams it is
 *     GIVEN; it cannot union with what is already on the row, which it never
 *     reads.
 *  3. CONTENT REWRITE. The enrich branch also overwrites `title_i18n`,
 *     `summary_i18n`, `prelims_facts`, `mains_brief`, `possible_questions`,
 *     `node_significance`, `category`, `gs_papers`, `is_up_specific` and
 *     `status` — and an item the target exam gates out is set to `archived`,
 *     pulling a perfectly good live item out of the feed for every OTHER exam.
 *
 * An additive "map exam B onto the existing corpus" pass is a DIFFERENT
 * operation: triage-only, no enrich, selecting PUBLISHED items rather than
 * unscored ones, writing a UNION of the stored arrays with the new verdict, and
 * touching no content column and no status. It does not exist yet —
 * `docs/OUTSTANDING.md` §8c **M48**.
 */
import { supabase } from "../lib/supabase.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT, runBatch, structuredParams, type BatchRequest } from "../lib/anthropic.js";
import { i18nComplete } from "../ingest/_shared.js";
import {
  enrichParams,
  normalizeTriage,
  triageParams,
  type EnrichResult,
  type SyllabusCandidate,
  type TriageResult,
} from "./prompts.js";
import { RELEVANCE_GATE, mergeExamTriages, type ExamTriage } from "./exam-fanout.js";
import { loadSyllabusCandidates } from "./syllabus-candidates.js";
import { selectAll } from "../lib/paginate.js";
import { CandidatePrefilter } from "./candidate-prefilter.js";
import type {
  CurrentAffairsFact,
  CurrentAffairsMainsBrief,
  CurrentAffairsNodeSignificance,
} from "@neev/shared";

const CHUNK_SIZE = 40;

// Token estimates for the cost projection (the triage input is dominated by the
// candidate list). triageInput was 2300, which measurement showed was far too
// low — a real full-list triage call is ~9235 input tokens, so the budget cap
// was under-projecting and could overshoot `--max-usd`. With the embedding
// pre-filter above (top-150 of the ~284-node tree) a call measures ~6100.
const EST = {
  triageInput: 6100,
  triageOutput: 260,
  enrichInput: 260,
  enrichOutput: 1500,
  survivalRate: 0.85, // published items already passed the OLD relevance filter
};

interface BackfillItem {
  id: string;
  title: string;
  snippet: string;
  is_up_specific: boolean;
}


/** Published items not yet re-scored under the new model (prelims_relevance null). */
async function loadItemsNeedingBackfill(): Promise<BackfillItem[]> {
  const data = await selectAll<Record<string, unknown>>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, title_i18n, summary_i18n, detail_i18n, is_up_specific")
      .eq("status", "published")
      .is("prelims_relevance", null)
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );
  return (data ?? []).map((r) => {
    const title = (r.title_i18n as { en?: string })?.en ?? "";
    const summary = (r.summary_i18n as { en?: string } | null)?.en ?? "";
    const legacy = (r.detail_i18n as { what_happened_i18n?: { en?: string } } | null)?.what_happened_i18n?.en ?? "";
    return {
      id: r.id as string,
      title,
      snippet: [summary, legacy].filter(Boolean).join(" ").slice(0, 1200),
      is_up_specific: !!r.is_up_specific,
    };
  });
}

export interface BackfillPlan {
  count: number;
  assumedSurvivors: number;
  triageCostUsd: number;
  enrichCostUsd: number;
  totalCostUsd: number;
}

/**
 * Estimate the cost of backfilling every not-yet-done item (no LLM calls).
 *
 * `examCodes` is REQUIRED because triage FANS OUT — one call per exam — while
 * enrichment does not. Omitting that factor under-projects by exactly the number
 * of exams, which is the same class of error that had `EST.triageInput` set to
 * 2300 against a measured ~6100: the number the operator budgets against is
 * quietly smaller than the number that gets billed. `runBackfill`'s own
 * per-chunk projection already multiplies by the scope count; this one did not,
 * so the two disagreed the moment a second exam entered the picture.
 */
export async function planBackfill(examCodes: string[]): Promise<BackfillPlan> {
  if (examCodes.length === 0) throw new Error("planBackfill: no target exams");
  const items = await loadItemsNeedingBackfill();
  const count = items.length;
  const survivors = Math.round(count * EST.survivalRate);

  const triagePer = estimateCostUsd(MODELS.haiku, EST.triageInput, EST.triageOutput) * BATCH_DISCOUNT;
  const enrichPer = estimateCostUsd(MODELS.haiku, EST.enrichInput, EST.enrichOutput) * BATCH_DISCOUNT;

  const triageCostUsd = triagePer * count * examCodes.length;
  const enrichCostUsd = enrichPer * survivors;
  return {
    count,
    assumedSurvivors: survivors,
    triageCostUsd,
    enrichCostUsd,
    totalCostUsd: triageCostUsd + enrichCostUsd,
  };
}

function buildNodeSignificance(
  enrich: EnrichResult,
  hasPrelims: boolean,
  hasMains: boolean,
): CurrentAffairsNodeSignificance | null {
  const record: CurrentAffairsNodeSignificance = {};
  const keep = (p?: { hi: string; en: string }) => (p && (p.hi.trim() || p.en.trim()) ? p : null);
  for (const row of enrich.node_significance ?? []) {
    const prelims = hasPrelims ? keep(row.prelims_i18n) : null;
    const mains = hasMains ? keep(row.mains_i18n) : null;
    if (prelims || mains) record[row.node_id] = { prelims_i18n: prelims, mains_i18n: mains };
  }
  return Object.keys(record).length > 0 ? record : null;
}

export interface BackfillRunResult {
  processed: number;
  archived: number;
  republished: number;
  draft: number;
  costUsd: number;
  stoppedForBudget: boolean;
  remaining: number;
}

type Log = (msg: string) => void;

export async function runBackfill(opts: {
  maxUsd: number;
  /**
   * WHICH EXAMS THIS BACKFILL RE-SCORES FOR. REQUIRED, never defaulted (M24) —
   * normally `liveExamCodes()`, overridable with `ca:backfill --exam <code>`.
   *
   * ⚑ THIS SET IS REPLACING, NOT ADDITIVE — see `runBackfill`'s own warning and
   * the header note. Narrowing it to one exam rewrites every processed row's
   * `exam_codes` and `syllabus_node_ids` to THAT exam's verdict alone.
   */
  examCodes: string[];
  log?: Log;
}): Promise<BackfillRunResult> {
  const log = opts.log ?? (() => {});
  // ONE SCOPE PER TARGET EXAM, exactly as the live pipeline does: triage fans
  // out (one call per exam, over that exam's OWN pool, in that exam's OWN
  // framing) and the verdicts are merged by `mergeExamTriages`. Enrichment stays
  // one call per item, framed by the exam that merge picks. With one exam this
  // collapses to the previous single pool / single call per item.
  const live = opts.examCodes;
  const scopes: { examCode: string; candidates: SyllabusCandidate[]; prefilter: CandidatePrefilter }[] = [];
  for (const examCode of live) {
    const candidates = await loadSyllabusCandidates({ examCodes: [examCode] });
    scopes.push({ examCode, candidates, prefilter: await CandidatePrefilter.create(candidates) });
  }
  if (scopes.length === 0) throw new Error("ca:backfill: no target exams — nothing to triage against");
  // Node ids are globally unique, so one merged map resolves any node's exam.
  const candidateById = new Map(scopes.flatMap((s) => s.candidates).map((c) => [c.id, c]));
  const all = await loadItemsNeedingBackfill();
  log(
    `items needing backfill: ${all.length}; budget cap: $${opts.maxUsd.toFixed(2)}; ` +
      `exams: ${live.join(", ")} (${scopes.length} triage call(s) per item)`,
  );
  // Loud, unconditional, and stated in terms of the columns actually written —
  // "exam_codes and syllabus_node_ids are REPLACED by this scope's verdict" is
  // the thing an operator running `--exam <one-exam>` over a shared corpus needs
  // to know BEFORE the first chunk commits, not after. See the header.
  log(
    `⚑ REWRITE, NOT MERGE: every processed row's exam_codes + syllabus_node_ids are REPLACED by this run's ` +
      `verdict for [${live.join(", ")}] — codes/nodes from any exam outside that set are DROPPED — and each ` +
      `enriched row's title/summary/facts/mains_brief/category/gs_papers/is_up_specific/status are rewritten.`,
  );

  const result: BackfillRunResult = {
    processed: 0,
    archived: 0,
    republished: 0,
    draft: 0,
    costUsd: 0,
    stoppedForBudget: false,
    remaining: all.length,
  };

  // Rough per-chunk projection to decide whether we can afford the next chunk.
  // Triage is multiplied by the number of live exams — it fans out, enrichment
  // does not. Omitting that factor would under-project and overshoot --max-usd,
  // the same class of error that had `EST.triageInput` set to 2300.
  const chunkProjection =
    estimateCostUsd(MODELS.haiku, EST.triageInput, EST.triageOutput) *
      BATCH_DISCOUNT *
      CHUNK_SIZE *
      scopes.length +
    estimateCostUsd(MODELS.haiku, EST.enrichInput, EST.enrichOutput) * BATCH_DISCOUNT * CHUNK_SIZE * EST.survivalRate;

  for (let start = 0; start < all.length; start += CHUNK_SIZE) {
    if (result.costUsd + chunkProjection > opts.maxUsd) {
      result.stoppedForBudget = true;
      log(`stopping before chunk at ${start}: projected spend would exceed cap (spent $${result.costUsd.toFixed(4)})`);
      break;
    }
    const chunk = all.slice(start, start + CHUNK_SIZE);
    log(`chunk ${start / CHUNK_SIZE + 1}: ${chunk.length} items (triage)...`);

    // --- Phase 1: triage batch, fanned out per live exam ---
    // Same embedding pre-filter as the live pipeline, but batched: every item
    // in the chunk is embedded in one call rather than one call per item, and
    // once PER EXAM because the pre-filter (and its fixed K) is per exam.
    // chunkCandidates[e][i] MUST be reused for normalizeTriage below —
    // validating against the full list would accept ids the model was never
    // shown, and across exams it would accept another exam's nodes outright.
    const chunkCandidates: SyllabusCandidate[][][] = [];
    for (const scope of scopes) {
      chunkCandidates.push(
        await scope.prefilter.narrowMany(
          chunk.map((it) => ({ title: it.title, snippet: it.snippet })),
          (u) => (result.costUsd += u.costUsd),
        ),
      );
    }
    const customIdFor = (itemIdx: number, examIdx: number) => `t_${itemIdx}_e${examIdx}`;
    const triageReqs: BatchRequest[] = scopes.flatMap((scope, e) =>
      chunk.map((it, i) => ({
        customId: customIdFor(i, e),
        params: structuredParams(
          triageParams({
            title: it.title,
            snippet: it.snippet,
            sourceIsUp: it.is_up_specific,
            candidates: chunkCandidates[e][i],
            examCode: scope.examCode,
          }),
        ),
        purpose: "ca_triage" as const,
        // Attributed to the exam whose pool/framing this request carries —
        // triage fans out one request per live exam (migration 0114).
        examCode: scope.examCode,
      })),
    );
    const triageRes = await runBatch(triageReqs, { onUsage: (u) => (result.costUsd += u.costUsd) });

    // Per item: whichever exams came back usable. An item with none is left
    // untouched and retried next run; PARTIAL results are kept (see the same
    // reasoning in pipeline.ts's collectBatch) rather than discarding triage
    // that has already been paid for.
    const triaged: (ExamTriage[] | null)[] = chunk.map((it, i) => {
      const perExam: ExamTriage[] = [];
      scopes.forEach((scope, e) => {
        const r = triageRes.get(customIdFor(i, e));
        if (!r?.ok) return;
        try {
          perExam.push({
            examCode: scope.examCode,
            triage: normalizeTriage(
              JSON.parse(r.text) as TriageResult,
              chunkCandidates[e][i],
              it.is_up_specific,
              scope.examCode,
            ),
          });
        } catch {
          /* unusable (usually truncated) — that exam simply does not claim it */
        }
      });
      return perExam.length > 0 ? perExam : null;
    });

    // Archive gated items immediately (checkpoint).
    const survivors: { idx: number; merged: ReturnType<typeof mergeExamTriages> }[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const perExam = triaged[i];
      if (!perExam) continue; // leave untouched → retried next run
      const merged = mergeExamTriages(perExam, candidateById);
      const triage = merged.triage;
      const best = Math.max(triage.prelims_relevance, triage.mains_relevance);
      if (best < RELEVANCE_GATE) {
        await supabase()
          .from("current_affairs_items")
          .update({
            status: "archived",
            category: triage.category,
            is_up_specific: triage.is_up_specific,
            prelims_relevance: triage.prelims_relevance,
            mains_relevance: triage.mains_relevance,
            gs_papers: triage.gs_papers,
            syllabus_node_ids: triage.syllabus_node_ids,
            // Kept in step with syllabus_node_ids, which this same statement
            // rewrites. Leaving the pre-existing exam_codes behind would make the
            // row disagree with the nodes it now points at — and with the
            // embedding `ca:embed` later stamps from that array.
            exam_codes: merged.itemExamCodes,
          })
          .eq("id", chunk[i].id);
        result.archived++;
        result.processed++;
      } else {
        survivors.push({ idx: i, merged });
      }
    }

    // --- Phase 2: enrich batch (survivors only) ---
    if (survivors.length > 0) {
      log(`chunk ${start / CHUNK_SIZE + 1}: ${survivors.length} survivors (enrich)...`);
      const enrichReqs: BatchRequest[] = survivors.map((s, j) => {
        const triage = s.merged.triage;
        const hasPrelims = triage.prelims_relevance >= RELEVANCE_GATE;
        const hasMains = triage.mains_relevance >= RELEVANCE_GATE;
        const linkedNodes = triage.syllabus_node_ids
          .map((id) => candidateById.get(id))
          .filter((n): n is SyllabusCandidate => !!n);
        return {
          customId: `e_${j}`,
          params: structuredParams(
            enrichParams({
              title: chunk[s.idx].title,
              snippet: chunk[s.idx].snippet,
              category: triage.category,
              hasPrelimsLife: hasPrelims,
              hasMainsLife: hasMains,
              linkedNodes,
              // Chosen explicitly from the exams that cleared the gate — never a
              // silent fallback to the default. See resolveItemFramingExam.
              examCode: s.merged.framingExamCode,
            }),
          ),
          purpose: "ca_enrich",
          // One shared call, one framing exam — the same value the prompt above
          // is built with, so the row records the voice that was paid for.
          examCode: s.merged.framingExamCode,
        };
      });
      const enrichRes = await runBatch(enrichReqs, { onUsage: (u) => (result.costUsd += u.costUsd) });

      for (let j = 0; j < survivors.length; j++) {
        const s = survivors[j];
        const r = enrichRes.get(`e_${j}`);
        if (!r?.ok) continue; // leave untouched → retried next run
        let enrich: EnrichResult;
        try {
          enrich = JSON.parse(r.text) as EnrichResult;
        } catch {
          continue;
        }
        const triage = s.merged.triage;
        const hasPrelims = triage.prelims_relevance >= RELEVANCE_GATE;
        const hasMains = triage.mains_relevance >= RELEVANCE_GATE;
        const prelimsFacts: CurrentAffairsFact[] | null =
          hasPrelims && enrich.prelims_facts.length > 0 ? enrich.prelims_facts : null;
        const mainsBrief: CurrentAffairsMainsBrief | null =
          hasMains && enrich.mains_brief.why_in_news_i18n.en.trim() ? enrich.mains_brief : null;
        const republished = i18nComplete(enrich.title_i18n) && i18nComplete(enrich.summary_i18n);

        await supabase()
          .from("current_affairs_items")
          .update({
            status: republished ? "published" : "draft",
            category: triage.category,
            is_up_specific: triage.is_up_specific,
            prelims_relevance: triage.prelims_relevance,
            mains_relevance: triage.mains_relevance,
            gs_papers: triage.gs_papers,
            // Framing exam first — see mergeExamTriages. Written here for the
            // same reason as on the archive path above: this statement rewrites
            // syllabus_node_ids, so exam_codes must move with it.
            exam_codes: s.merged.itemExamCodes,
            title_i18n: enrich.title_i18n,
            summary_i18n: enrich.summary_i18n,
            prelims_facts: prelimsFacts,
            mains_brief: mainsBrief,
            possible_questions: {
              prelims_i18n: hasPrelims ? enrich.possible_questions.prelims_i18n : null,
              mains_i18n: hasMains ? enrich.possible_questions.mains_i18n : null,
            },
            node_significance: buildNodeSignificance(enrich, hasPrelims, hasMains),
            syllabus_node_ids: triage.syllabus_node_ids,
          })
          .eq("id", chunk[s.idx].id);
        result.processed++;
        if (republished) result.republished++;
        else result.draft++;
      }
    }

    log(`chunk done — processed ${result.processed}, archived ${result.archived}, spent $${result.costUsd.toFixed(4)}`);
  }

  result.remaining = all.length - result.processed;
  return result;
}
