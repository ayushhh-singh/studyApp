/**
 * One-time backfill: blind-verify every needs_review CA MCQ generated BEFORE
 * the verify-at-generation-time fix landed (ca/pipeline.ts's insertMcqsForItem
 * now runs this inline for every new MCQ — see ca/prompts.ts's verifyMcq).
 * Those older rows have `generation_meta = null`, so the Review Queue's
 * high-confidence bulk-approve (isHighConfidenceQuestion, @neev/shared) can
 * never recognize them — this backfill populates generation_meta.verify_result
 * on each one, using the identical qgen blind-verify mechanism (a fresh haiku
 * call, key hidden, grounded on the SAME facts the MCQ was written from,
 * looked up by reversing current_affairs_items.mcq_question_ids).
 *
 * - Cost-capped by --max-usd (Message Batches API, 50% off — same convention
 *   as ca/backfill.ts). Stops cleanly when the next chunk would exceed the
 *   cap; the remaining questions are picked up on the next run.
 * - Resumable: a question is "done" once its generation_meta is non-null, so
 *   a re-run only processes what's left.
 */
import { supabase } from "../lib/supabase.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT, runBatch, structuredParams, type BatchRequest } from "../lib/anthropic.js";
import { buildVerifyParams, parseVerify } from "../qgen/prompts.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import type { GroundingResult } from "../services/evaluation/grounding.js";

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 40;

// Token estimates for the cost projection (a short stem + 4 options + a
// handful of facts in, a bare {chosen_key, confidence} JSON out).
const EST = { input: 400, output: 30 };

interface BilingualPair {
  hi: string;
  en: string;
}

interface PendingMcq {
  id: string;
  stem_i18n: BilingualPair;
  options_i18n: { key: string; text_i18n: BilingualPair }[];
  correct_option_key: string;
}

async function loadPendingMcqs(): Promise<PendingMcq[]> {
  const out: PendingMcq[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, stem_i18n, options_i18n, correct_option_key")
      .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
      .eq("type", "mcq")
      .eq("review_state", "needs_review")
      .is("generation_meta", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`pending CA mcq query failed: ${error.message}`);
    out.push(...((data ?? []) as PendingMcq[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/** Reverse current_affairs_items.mcq_question_ids -> the item's prelims_facts, for every item that has any MCQs at all. */
async function loadFactsByQuestionId(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase()
      .from("current_affairs_items")
      .select("mcq_question_ids, prelims_facts")
      .not("mcq_question_ids", "eq", "{}")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`current_affairs_items query failed: ${error.message}`);
    for (const row of data ?? []) {
      const ids = (row.mcq_question_ids ?? []) as string[];
      const facts = ((row.prelims_facts ?? []) as { fact_i18n: BilingualPair }[]).map((f) => f.fact_i18n.en);
      for (const id of ids) map.set(id, facts);
    }
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return map;
}

export interface VerifyMcqPlan {
  count: number;
  costUsd: number;
}

/** Estimate the cost of confidence-checking every not-yet-checked CA MCQ (no LLM calls). */
export async function planVerifyMcqs(): Promise<VerifyMcqPlan> {
  const pending = await loadPendingMcqs();
  const perCall = estimateCostUsd(MODELS.haiku, EST.input, EST.output) * BATCH_DISCOUNT;
  return { count: pending.length, costUsd: perCall * pending.length };
}

export interface VerifyMcqRunResult {
  processed: number;
  agreed: number;
  disagreed: number;
  noFactsFound: number;
  costUsd: number;
  stoppedForBudget: boolean;
  remaining: number;
}

type Log = (msg: string) => void;

export async function runVerifyMcqs(opts: { maxUsd: number; log?: Log }): Promise<VerifyMcqRunResult> {
  const log = opts.log ?? (() => {});
  const [pending, factsByQuestionId] = await Promise.all([loadPendingMcqs(), loadFactsByQuestionId()]);
  log(`pending CA MCQs needing a confidence check: ${pending.length}; budget cap: $${opts.maxUsd.toFixed(2)}`);

  const result: VerifyMcqRunResult = {
    processed: 0,
    agreed: 0,
    disagreed: 0,
    noFactsFound: 0,
    costUsd: 0,
    stoppedForBudget: false,
    remaining: pending.length,
  };

  const chunkProjection = estimateCostUsd(MODELS.haiku, EST.input, EST.output) * BATCH_DISCOUNT * CHUNK_SIZE;

  for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
    if (result.costUsd + chunkProjection > opts.maxUsd) {
      result.stoppedForBudget = true;
      log(`stopping before chunk at ${start}: projected spend would exceed cap (spent $${result.costUsd.toFixed(4)})`);
      break;
    }
    const chunk = pending.slice(start, start + CHUNK_SIZE);
    log(`chunk ${start / CHUNK_SIZE + 1}: ${chunk.length} questions...`);

    // A question whose originating current_affairs_items row can't be found
    // (facts.length === 0) is skipped entirely rather than blind-verified
    // ungrounded — CA questions test very recent news a model's training data
    // won't reliably know, so an ungrounded "agreement" would be a coin flip,
    // not real confidence. Left with generation_meta still null: it never
    // becomes spuriously bulk-approvable, always needs a human look instead.
    const withFacts = chunk.filter((q) => {
      const facts = factsByQuestionId.get(q.id) ?? [];
      if (facts.length === 0) {
        result.noFactsFound++;
        return false;
      }
      return true;
    });

    const requests: BatchRequest[] = withFacts.map((q) => {
      const facts = factsByQuestionId.get(q.id) ?? [];
      const grounding: GroundingResult = {
        chunks: facts.map((f, i) => ({ source_type: "current_affairs", source_id: `fact-${i}`, chunk_text: f, similarity: 1 })),
        nodeChunkCount: 0,
      };
      return {
        // Message Batches custom_id must match ^[a-zA-Z0-9_-]{1,64}$ — a bare
        // question uuid (hyphens + alphanumerics only) satisfies that directly.
        customId: q.id,
        params: structuredParams(buildVerifyParams({ stemEn: q.stem_i18n.en, options: q.options_i18n, grounding })),
        purpose: "ca_mcq_verify",
      };
    });

    const results = requests.length > 0 ? await runBatch(requests, { onUsage: (u) => (result.costUsd += u.costUsd) }) : new Map();

    for (const q of chunk) {
      const r = results.get(q.id);
      if (!r?.ok) continue; // leave untouched → retried next run
      let verify;
      try {
        verify = parseVerify(JSON.parse(r.text), q.correct_option_key);
      } catch {
        continue; // unparseable — leave untouched → retried next run
      }
      const { error } = await supabase()
        .from("questions")
        .update({ generation_meta: { model: MODELS.haiku, verify_result: verify, backfilled: true } })
        .eq("id", q.id);
      if (error) {
        log(`  write failed for ${q.id}: ${error.message}`);
        continue;
      }
      result.processed++;
      if (verify.matches_key) result.agreed++;
      else result.disagreed++;
    }
    log(`chunk done — processed ${result.processed} (agreed ${result.agreed}, disagreed ${result.disagreed}), spent $${result.costUsd.toFixed(4)}`);
  }

  result.remaining = pending.length - result.processed;
  return result;
}
