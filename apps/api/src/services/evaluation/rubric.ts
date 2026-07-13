/**
 * UPPSC Mains answer-evaluation rubrics — a versioned registry.
 *
 * Every rubric uses the SAME six dimension keys (shared with the web app via
 * @neev/shared, so the client renders any variant with its existing labels
 * and dials) but assigns version-specific WEIGHTS and examiner DESCRIPTIONS:
 *
 *  - "v1"        — the general Mains descriptive-answer rubric (GS papers).
 *  - "essay-v1"  — the UPPSC Essay paper (निबंध): one ~700-word essay for 50
 *    marks, chosen from a section. Verified against the official paper pattern
 *    (3 sections × 1-of-3 topics × 50 marks × 700 words); the marking is
 *    holistic/descriptive with the official directive "keep closely to the
 *    subject, arrange ideas in an orderly fashion, write concisely; credit for
 *    effective and exact expression" — reflected in the weights below (coverage
 *    + substantiation + language weigh more than headings/presentation).
 *
 * The weights + descriptions are server-only exam-domain knowledge; the
 * dimension keys are the shared contract. Weights within a rubric sum to 1.0
 * (asserted at load).
 */
import { RUBRIC_VERSION, ESSAY_RUBRIC_VERSION, type DimensionScore, type RubricDimensionKey } from "@neev/shared";

export { RUBRIC_VERSION, ESSAY_RUBRIC_VERSION };

/** Fallback max marks when a custom prompt / question carries no `marks`. */
export const DEFAULT_MAX_SCORE = 10;
/** Fallback word limit when none is supplied (a typical UPPSC Mains sub-Q). */
export const DEFAULT_WORD_LIMIT = 150;

export interface RubricDimension {
  key: RubricDimensionKey;
  label: string;
  /** 0..1; all dimensions in a rubric sum to 1.0. */
  weight: number;
  /** Examiner guidance injected into the scoring prompt. */
  description: string;
}

export interface RubricDefinition {
  version: string;
  /** Ordered so pass-1 output and the SSE `dimension_score` events keep one order. */
  dimensions: readonly RubricDimension[];
}

// ---------------------------------------------------------------------------
// v1 — general Mains descriptive answer
// ---------------------------------------------------------------------------
const V1_DIMENSIONS: readonly RubricDimension[] = [
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
];

// ---------------------------------------------------------------------------
// essay-v1 — UPPSC Essay paper (one ~700-word essay, 50 marks)
// ---------------------------------------------------------------------------
const ESSAY_V1_DIMENSIONS: readonly RubricDimension[] = [
  {
    key: "structure_flow",
    label: "Structure & Coherence",
    weight: 0.2,
    description:
      "A compelling introduction that frames the theme, a well-organised body, and a " +
      "forward-looking conclusion. Paragraphs link smoothly with clear transitions and the " +
      "essay reads as one continuous, orderly argument — the official directive to 'arrange " +
      "ideas in an orderly fashion'.",
  },
  {
    key: "content_coverage",
    label: "Relevance & Multidimensional Coverage",
    weight: 0.3,
    description:
      "The essay stays closely on the chosen topic (no padding) AND treats it from multiple " +
      "angles — political, economic, social, technological, legal, environmental, ethical as " +
      "relevant — with cause, effect, and solution, and a balanced, objective view of more " +
      "than one side. The most heavily weighted dimension.",
  },
  {
    key: "keywords_concepts",
    label: "Depth & Critical Analysis",
    weight: 0.1,
    description:
      "Analysis over mere description: original insight, nuanced argument, and precise use of " +
      "relevant concepts and terminology rather than generic, surface-level statements.",
  },
  {
    key: "examples_data",
    label: "Substantiation",
    weight: 0.2,
    description:
      "Arguments are backed with concrete facts, data, real examples, case studies, apt " +
      "quotations, historical references, and UP-/India-specific evidence — not unsupported " +
      "generalisation.",
  },
  {
    key: "presentation",
    label: "Presentation",
    weight: 0.05,
    description:
      "Overall readability and flow. Essays are continuous prose, so credit clean paragraphing " +
      "and (sparingly) a helpful sub-heading; do not require the bullet/heading layout of a GS " +
      "answer.",
  },
  {
    key: "word_limit_language",
    label: "Language & Expression",
    weight: 0.15,
    description:
      "Stays close to the ~700-word limit and is written concisely with effective and exact " +
      "expression — clear, grammatical, precise, and engaging language, the official mark of " +
      "credit for the essay.",
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const RUBRICS: Record<string, RubricDefinition> = {
  [RUBRIC_VERSION]: { version: RUBRIC_VERSION, dimensions: V1_DIMENSIONS },
  [ESSAY_RUBRIC_VERSION]: { version: ESSAY_RUBRIC_VERSION, dimensions: ESSAY_V1_DIMENSIONS },
};

// Fail fast if any rubric's weights drift from summing to 1.0.
for (const def of Object.values(RUBRICS)) {
  const sum = def.dimensions.reduce((s, d) => s + d.weight, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`Rubric ${def.version} weights must sum to 1.0, got ${sum}`);
  }
}

/** The rubric for a version, defaulting to v1 for any unknown/legacy value. */
export function getRubric(version: string): RubricDefinition {
  return RUBRICS[version] ?? RUBRICS[RUBRIC_VERSION];
}

/** The ordered dimensions for a rubric version. */
export function rubricDimensions(version: string): readonly RubricDimension[] {
  return getRubric(version).dimensions;
}

export function rubricDimension(version: string, key: RubricDimensionKey): RubricDimension {
  const d = getRubric(version).dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`Unknown rubric dimension: ${key}`);
  return d;
}

/**
 * Weighted overall score on the question's max-marks scale.
 * fraction = Σ (score/10 * weight); overall = fraction * maxScore, 2 dp.
 * Weights come from the DimensionScore array (built from the chosen rubric), so
 * this is version-agnostic. Scores are clamped to 0-10 defensively.
 */
export function computeOverallScore(scores: DimensionScore[], maxScore: number): number {
  const fraction = scores.reduce((sum, s) => {
    const clamped = Math.min(10, Math.max(0, s.score));
    return sum + (clamped / 10) * s.weight;
  }, 0);
  return Math.round(fraction * maxScore * 100) / 100;
}

/** Render a rubric version as a numbered list for the examiner prompt. */
export function renderRubricForPrompt(version: string = RUBRIC_VERSION): string {
  return getRubric(version)
    .dimensions.map(
      (d, i) =>
        `${i + 1}. ${d.label} [key: ${d.key}, weight ${Math.round(d.weight * 100)}%]\n   ${d.description}`,
    )
    .join("\n");
}

// Back-compat: the v1 dimension list + key order used by callers that predate
// the registry. New code should call rubricDimensions(version) instead.
export const RUBRIC_DIMENSIONS = V1_DIMENSIONS;
export const RUBRIC_DIMENSION_KEYS: readonly RubricDimensionKey[] = V1_DIMENSIONS.map((d) => d.key);
