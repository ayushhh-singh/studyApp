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
