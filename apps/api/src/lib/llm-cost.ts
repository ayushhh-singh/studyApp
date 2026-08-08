/**
 * Pricing an `llm_calls` ROW — the one place that turns a stored row's token
 * columns into a dollar figure.
 *
 * WHY THIS MODULE EXISTS: `scripts/cost-report.ts` and the admin per-user cost
 * rollup must not disagree about what a call cost. The pricing MATH already
 * lives in one place (`lib/models.ts`'s `MODEL_PRICING` / `priceSetFor` /
 * `costFromPriceSet` / `estimateCostUsd`) and is not reimplemented here — what
 * was duplicated, and is consolidated here, is the two bits of glue every
 * consumer needs around it: the `ModelId` type guard (which cost-report had as
 * a private local copy) and the batch-discount application.
 *
 * ── WHY RECOMPUTE INSTEAD OF READING `cost_usd` ─────────────────────────────
 * `llm_calls.cost_usd` is written at call time by `recordLlmCall`, so it is
 * frozen at whatever MODEL_PRICING said on the day of the call. `cost:report`
 * deliberately recomputes from the token columns instead, and this module does
 * the same, for two reasons:
 *   1. A correction to MODEL_PRICING should retroactively fix every figure. The
 *      repo has a live instance of exactly this: the standing note that
 *      MODEL_PRICING is currently one tier high versus Anthropic's published
 *      sonnet-5 prices. Reading the stored column would permanently bake that
 *      in for historical rows.
 *   2. `MODEL_PRICING[*].standard` is a documented PLACEHOLDER, so anything
 *      priced under it must be recomputable when the real number lands.
 * The consequence, stated plainly: these figures can differ from the stored
 * `cost_usd` sum. That is intended — they are the CURRENT best estimate of what
 * those tokens cost, on one consistent schedule, not a historical ledger.
 *
 * ⚑ A DATED DIVERGENCE FROM cost:report, worth knowing before comparing them.
 * This module prices each row under the schedule in effect at THAT ROW's
 * timestamp, while cost:report's headline column prices everything under
 * `intro`. Those agree exactly today and did so on every existing row when this
 * landed — verified: all 282 attributable rows, $7.535361 both ways, zero rows
 * differing — because `standardEffectiveDate` is 2026-09-01 and nothing predates
 * it. AFTER that date the two will part company on new rows: this module will
 * follow `standard` (which is a documented PLACEHOLDER until Anthropic publishes
 * post-intro prices) while cost:report keeps showing intro and standard side by
 * side. That is the correct behaviour for a "what did serving this user cost"
 * figure, but it means a mismatch after 2026-09-01 is expected, not a bug.
 */
import { BATCH_DISCOUNT } from "./anthropic.js";
import { MODEL_PRICING, costFromPriceSet, priceSetFor, type ModelId } from "./models.js";

/**
 * `llm_calls.model` is a free-text column, so a row can name a model that
 * MODEL_PRICING has no entry for (a retired id, or a call logged by a sibling
 * app sharing this database — `sukoon_*` purposes are present in this table).
 * Indexing MODEL_PRICING with such a value yields `undefined` and then `NaN`
 * cost, which would silently poison a total; every caller must narrow first.
 */
export function isModelId(m: string): m is ModelId {
  return m in MODEL_PRICING;
}

/** The subset of an `llm_calls` row needed to price it. */
export interface PriceableLlmCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  meta: { batch?: boolean } | null;
  created_at: string;
}

/**
 * What this call cost, in USD, priced under the schedule that was in effect at
 * the moment it was made (`priceSetFor(model, created_at)`) — so a window
 * spanning the intro→standard transition prices each row correctly instead of
 * applying one schedule to all of them.
 *
 * Returns NULL, never 0, for a model MODEL_PRICING does not know. Zero would be
 * indistinguishable from a genuinely free call and would silently understate a
 * total; null forces the caller to decide, and lets it report the unpriceable
 * rows separately rather than hiding them.
 */
export function priceLlmCall(row: PriceableLlmCall): number | null {
  if (!isModelId(row.model)) return null;
  const base = costFromPriceSet(
    priceSetFor(row.model, new Date(row.created_at)),
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens ?? 0,
    row.cache_write_tokens ?? 0,
  );
  // Message Batches API rows are billed at 0.5x, flagged as meta.batch by
  // recordLlmCall — the same discount cost-report's bucketCost applies.
  return row.meta?.batch ? base * BATCH_DISCOUNT : base;
}
