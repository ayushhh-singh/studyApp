/**
 * The single source of truth for Anthropic model ids.
 *
 * Per CLAUDE.md: model ids live in ONE constants module and are NEVER inlined.
 *  - claude-sonnet-5   → answer evaluation, doubt chat, and any task needing
 *                        the strongest reasoning / vision (PYQ structuring,
 *                        scanned-page OCR via vision, syllabus structuring).
 *  - claude-haiku-4-5  → high-volume, lower-stakes tasks (summaries, MCQ
 *                        explanations, translation drafts, classification).
 */
export const MODELS = {
  /** Strongest model — reasoning + vision. */
  sonnet: "claude-sonnet-5",
  /** High-volume, cost-efficient model. */
  haiku: "claude-haiku-4-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export interface ModelPriceSet {
  input: number;
  output: number;
}

/**
 * Both the current introductory pricing and the standard pricing that
 * follows it, USD per million tokens, with the UTC date standard pricing
 * takes over. Used only for the internal llm_calls cost estimate/dashboard —
 * not a billing source of truth. The `standard` figures below are a
 * PLACEHOLDER (not yet confirmed against Anthropic's published pricing page)
 * — the cost:report script surfaces both so the jump is visible ahead of
 * time; update `standard` once the real post-intro price is announced.
 */
export interface ModelPricingSchedule {
  intro: ModelPriceSet;
  standard: ModelPriceSet;
  standardEffectiveDate: string;
}

export const MODEL_PRICING: Record<ModelId, ModelPricingSchedule> = {
  "claude-sonnet-5": {
    intro: { input: 3.0, output: 15.0 },
    standard: { input: 4.0, output: 20.0 },
    standardEffectiveDate: "2026-09-01",
  },
  "claude-haiku-4-5": {
    intro: { input: 1.0, output: 5.0 },
    standard: { input: 1.25, output: 6.25 },
    standardEffectiveDate: "2026-09-01",
  },
};

/** The price set actually in effect for a given call time (defaults to now). */
export function priceSetFor(model: ModelId, at: Date = new Date()): ModelPriceSet {
  const schedule = MODEL_PRICING[model];
  return at >= new Date(schedule.standardEffectiveDate) ? schedule.standard : schedule.intro;
}

/**
 * Cache reads are billed at 0.1x the base input price; cache writes (5-minute
 * ephemeral TTL, the only TTL this codebase uses) at 1.25x — both on top of
 * the plain (uncached) input/output token cost. Exported so the cost:report
 * script can price the same token counts under an arbitrary price set (e.g.
 * "standard", regardless of whether it's actually in effect yet).
 */
export function costFromPriceSet(
  pricing: ModelPriceSet,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheReadTokens * pricing.input * 0.1 +
      cacheWriteTokens * pricing.input * 1.25) /
    1_000_000
  );
}

export function estimateCostUsd(
  model: ModelId,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  at?: Date,
): number {
  return costFromPriceSet(priceSetFor(model, at), inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
}
