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
import { RELEVANCE_GATE } from "./pipeline.js";
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

/** Estimate the cost of backfilling every not-yet-done item (no LLM calls). */
export async function planBackfill(): Promise<BackfillPlan> {
  const items = await loadItemsNeedingBackfill();
  const count = items.length;
  const survivors = Math.round(count * EST.survivalRate);

  const triagePer = estimateCostUsd(MODELS.haiku, EST.triageInput, EST.triageOutput) * BATCH_DISCOUNT;
  const enrichPer = estimateCostUsd(MODELS.haiku, EST.enrichInput, EST.enrichOutput) * BATCH_DISCOUNT;

  const triageCostUsd = triagePer * count;
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

export async function runBackfill(opts: { maxUsd: number; log?: Log }): Promise<BackfillRunResult> {
  const log = opts.log ?? (() => {});
  const candidates = await loadSyllabusCandidates();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const prefilter = await CandidatePrefilter.create(candidates);
  const all = await loadItemsNeedingBackfill();
  log(`items needing backfill: ${all.length}; budget cap: $${opts.maxUsd.toFixed(2)}`);

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
  const chunkProjection =
    estimateCostUsd(MODELS.haiku, EST.triageInput, EST.triageOutput) * BATCH_DISCOUNT * CHUNK_SIZE +
    estimateCostUsd(MODELS.haiku, EST.enrichInput, EST.enrichOutput) * BATCH_DISCOUNT * CHUNK_SIZE * EST.survivalRate;

  for (let start = 0; start < all.length; start += CHUNK_SIZE) {
    if (result.costUsd + chunkProjection > opts.maxUsd) {
      result.stoppedForBudget = true;
      log(`stopping before chunk at ${start}: projected spend would exceed cap (spent $${result.costUsd.toFixed(4)})`);
      break;
    }
    const chunk = all.slice(start, start + CHUNK_SIZE);
    log(`chunk ${start / CHUNK_SIZE + 1}: ${chunk.length} items (triage)...`);

    // --- Phase 1: triage batch ---
    // Same embedding pre-filter as the live pipeline, but batched: every item
    // in the chunk is embedded in one call rather than one call per item.
    // chunkCandidates[i] MUST be reused for normalizeTriage below — validating
    // against the full list would accept ids the model was never shown.
    const chunkCandidates = await prefilter.narrowMany(
      chunk.map((it) => ({ title: it.title, snippet: it.snippet })),
      (u) => (result.costUsd += u.costUsd),
    );
    const triageReqs: BatchRequest[] = chunk.map((it, i) => ({
      customId: `t_${i}`,
      params: structuredParams(triageParams({ title: it.title, snippet: it.snippet, sourceIsUp: it.is_up_specific, candidates: chunkCandidates[i] })),
      purpose: "ca_triage",
    }));
    const triageRes = await runBatch(triageReqs, { onUsage: (u) => (result.costUsd += u.costUsd) });

    const triaged: (TriageResult | null)[] = chunk.map((it, i) => {
      const r = triageRes.get(`t_${i}`);
      if (!r?.ok) return null;
      try {
        return normalizeTriage(JSON.parse(r.text) as TriageResult, chunkCandidates[i], it.is_up_specific);
      } catch {
        return null;
      }
    });

    // Archive gated items immediately (checkpoint).
    const survivors: { idx: number; triage: TriageResult }[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const triage = triaged[i];
      if (!triage) continue; // leave untouched → retried next run
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
          })
          .eq("id", chunk[i].id);
        result.archived++;
        result.processed++;
      } else {
        survivors.push({ idx: i, triage });
      }
    }

    // --- Phase 2: enrich batch (survivors only) ---
    if (survivors.length > 0) {
      log(`chunk ${start / CHUNK_SIZE + 1}: ${survivors.length} survivors (enrich)...`);
      const enrichReqs: BatchRequest[] = survivors.map((s, j) => {
        const hasPrelims = s.triage.prelims_relevance >= RELEVANCE_GATE;
        const hasMains = s.triage.mains_relevance >= RELEVANCE_GATE;
        const linkedNodes = s.triage.syllabus_node_ids
          .map((id) => candidateById.get(id))
          .filter((n): n is SyllabusCandidate => !!n);
        return {
          customId: `e_${j}`,
          params: structuredParams(
            enrichParams({
              title: chunk[s.idx].title,
              snippet: chunk[s.idx].snippet,
              category: s.triage.category,
              hasPrelimsLife: hasPrelims,
              hasMainsLife: hasMains,
              linkedNodes,
            }),
          ),
          purpose: "ca_enrich",
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
        const hasPrelims = s.triage.prelims_relevance >= RELEVANCE_GATE;
        const hasMains = s.triage.mains_relevance >= RELEVANCE_GATE;
        const prelimsFacts: CurrentAffairsFact[] | null =
          hasPrelims && enrich.prelims_facts.length > 0 ? enrich.prelims_facts : null;
        const mainsBrief: CurrentAffairsMainsBrief | null =
          hasMains && enrich.mains_brief.why_in_news_i18n.en.trim() ? enrich.mains_brief : null;
        const republished = i18nComplete(enrich.title_i18n) && i18nComplete(enrich.summary_i18n);

        await supabase()
          .from("current_affairs_items")
          .update({
            status: republished ? "published" : "draft",
            category: s.triage.category,
            is_up_specific: s.triage.is_up_specific,
            prelims_relevance: s.triage.prelims_relevance,
            mains_relevance: s.triage.mains_relevance,
            gs_papers: s.triage.gs_papers,
            title_i18n: enrich.title_i18n,
            summary_i18n: enrich.summary_i18n,
            prelims_facts: prelimsFacts,
            mains_brief: mainsBrief,
            possible_questions: {
              prelims_i18n: hasPrelims ? enrich.possible_questions.prelims_i18n : null,
              mains_i18n: hasMains ? enrich.possible_questions.mains_i18n : null,
            },
            node_significance: buildNodeSignificance(enrich, hasPrelims, hasMains),
            syllabus_node_ids: s.triage.syllabus_node_ids,
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
