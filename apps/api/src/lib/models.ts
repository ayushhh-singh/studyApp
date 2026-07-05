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

/**
 * Standard (non-introductory) sticker pricing, USD per million tokens.
 * Used only for the internal llm_calls cost estimate — not a billing source
 * of truth. Update if Anthropic's published per-token pricing changes.
 */
export const MODEL_PRICING_PER_MTOK: Record<ModelId, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export function estimateCostUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_PER_MTOK[model];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
