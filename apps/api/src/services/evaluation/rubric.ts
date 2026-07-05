/**
 * UPPSC Mains answer-evaluation rubric — version "v1".
 *
 * Six weighted dimensions, each scored 0-10 by the examiner model. The weighted
 * fraction (sum of score/10 * weight) is projected onto the question's max marks
 * to give the overall score. Weights sum to exactly 1.0.
 *
 * This module is the single source of truth for the dimensions, their weights,
 * and the examiner-facing descriptions injected into the pass-1 prompt. The
 * dimension *keys* are shared with the web app via @prayasup/shared; the weights
 * and descriptions are server-only exam-domain knowledge.
 */
import { RUBRIC_VERSION, type DimensionScore, type RubricDimensionKey } from "@prayasup/shared";

export { RUBRIC_VERSION };

/** Fallback max marks when a custom prompt / question carries no `marks`. */
export const DEFAULT_MAX_SCORE = 10;
/** Fallback word limit when none is supplied (a typical UPPSC Mains sub-Q). */
export const DEFAULT_WORD_LIMIT = 150;

export interface RubricDimension {
  key: RubricDimensionKey;
  label: string;
  /** 0..1; all dimensions sum to 1.0. */
  weight: number;
  /** Examiner guidance injected into the scoring prompt. */
  description: string;
}

/** Ordered so pass-1 output and the SSE `dimension_score` events keep one order. */
export const RUBRIC_DIMENSIONS: readonly RubricDimension[] = [
  {
    key: "structure_flow",
    label: "Structure & Flow",
    weight: 0.2,
    description:
      "A clear introduction, body, and conclusion are present and in that order. Ideas " +
      "progress logically, paragraphs connect, and the answer reads as a coherent whole " +
      "rather than disjointed points.",
  },
  {
    key: "content_coverage",
    label: "Content Coverage",
    weight: 0.3,
    description:
      "Every demand of the question is addressed, honouring its directive word (examine, " +
      "critically analyse, discuss, etc.). Points are syllabus-relevant and substantive, " +
      "with breadth and depth proportionate to the marks. This is the most heavily weighted " +
      "dimension.",
  },
  {
    key: "keywords_concepts",
    label: "Keywords & Concepts",
    weight: 0.15,
    description:
      "Correct, precise use of subject terminology and the relevant constitutional, " +
      "administrative, economic, or policy concepts — the vocabulary an examiner expects at " +
      "the Mains level.",
  },
  {
    key: "examples_data",
    label: "Examples & Data",
    weight: 0.15,
    description:
      "Claims are substantiated with concrete facts, figures, UP-specific data, committees " +
      "and commissions, constitutional articles, government schemes, case studies, or court " +
      "judgments — not left as unsupported assertions.",
  },
  {
    key: "presentation",
    label: "Presentation",
    weight: 0.1,
    description:
      "Readable organisation: helpful headings/sub-headings, and points or short paragraphs " +
      "where they aid clarity. Credit a diagram, flowchart, or map only if the candidate " +
      "explicitly states they have drawn one (this is typed text — none is visible).",
  },
  {
    key: "word_limit_language",
    label: "Word Limit & Language",
    weight: 0.1,
    description:
      "The answer respects the word limit — neither padded far beyond it nor too thin to " +
      "earn the marks — and the language is clear, grammatical, and exam-appropriate.",
  },
] as const;

// Fail fast if the weights ever drift from summing to 1.0.
const WEIGHT_SUM = RUBRIC_DIMENSIONS.reduce((s, d) => s + d.weight, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Rubric ${RUBRIC_VERSION} weights must sum to 1.0, got ${WEIGHT_SUM}`);
}

export const RUBRIC_DIMENSION_KEYS: readonly RubricDimensionKey[] = RUBRIC_DIMENSIONS.map((d) => d.key);

export function rubricDimension(key: RubricDimensionKey): RubricDimension {
  const d = RUBRIC_DIMENSIONS.find((x) => x.key === key);
  if (!d) throw new Error(`Unknown rubric dimension: ${key}`);
  return d;
}

/**
 * Weighted overall score on the question's max-marks scale.
 * fraction = Σ (score/10 * weight); overall = fraction * maxScore, 2 dp.
 * Scores are clamped to 0-10 defensively so a stray model value can't overshoot.
 */
export function computeOverallScore(scores: DimensionScore[], maxScore: number): number {
  const fraction = scores.reduce((sum, s) => {
    const clamped = Math.min(10, Math.max(0, s.score));
    return sum + (clamped / 10) * s.weight;
  }, 0);
  return Math.round(fraction * maxScore * 100) / 100;
}

/** Render the rubric as a numbered list for the examiner prompt. */
export function renderRubricForPrompt(): string {
  return RUBRIC_DIMENSIONS.map(
    (d, i) =>
      `${i + 1}. ${d.label} [key: ${d.key}, weight ${Math.round(d.weight * 100)}%]\n   ${d.description}`,
  ).join("\n");
}
