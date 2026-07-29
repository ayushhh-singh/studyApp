/**
 * Mains answer-evaluation rubrics — a versioned, EXAM-AWARE registry.
 *
 * Every rubric uses the SAME six dimension keys (shared with the web app via
 * @neev/shared, so the client renders any variant with its existing labels
 * and dials) but assigns version-specific WEIGHTS and examiner DESCRIPTIONS:
 *
 *  - "v1"        — UPPSC's general Mains descriptive-answer rubric (GS papers).
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
 *
 * ---------------------------------------------------------------------------
 * THE EXAM DIMENSION (added 2026-07-29 with `docs/OUTSTANDING.md` §8b M5)
 * ---------------------------------------------------------------------------
 * A rubric encodes ONE exam's mark scheme. UPSC's essay is ~1000-1200 words at
 * 125 marks each; MPPSC's Mains structure differs again — so "which rubric
 * applies" is a function of (exam, paper), never of paper code alone, and
 * "is this an essay?" cannot be the literal string comparison
 * `rubric_version <> 'essay-v1'` that 0069 and services/scoreboard.ts used to
 * make. Each definition therefore declares:
 *
 *   examCode   — whose mark scheme this is. Note this is the scheme's OWNER,
 *                which is NOT the same thing as `evaluations.exam_code` (the
 *                exam the answer belongs to, i.e. which board it competes on).
 *                The two agree except in one disclosed case: a live exam with
 *                content but no authored rubric yet falls back to the default
 *                exam's scheme (see resolveRubric), so the answer is graded
 *                under `v1` while still belonging to its own exam's board.
 *   kind       — "gs" | "essay", the board/percentile segmentation axis,
 *                stored on the evaluation row so SQL can split without knowing
 *                any version string.
 *   paperCodes — the paper codes that select this rubric (empty = the exam's
 *                default for every other paper). Paper codes are globally
 *                unique across exams (the §0 invariant), so these never
 *                collide; a second exam's essay paper is `UPSC_MAINS_ESSAY`.
 *   defaults   — the word limit / max marks to assume when the question or
 *                custom prompt carries none. These are exam-specific too (a
 *                700-word/50-mark default is UPPSC's essay, not UPSC's), so
 *                they live on the rubric rather than as module constants.
 *
 * NAMING CONVENTION for a new exam: `<exam>-<kind>-v<n>` (e.g. `upsc-gs-v1`).
 * UPPSC's two keep their historical bare names — the strings are persisted on
 * every existing `evaluations` row and are part of the
 * `question_model_answers (question_id, locale, rubric_version)` reuse key, so
 * renaming them would invalidate that cache and rewrite live history for no
 * behavioural gain.
 */
import {
  RUBRIC_VERSION,
  ESSAY_RUBRIC_VERSION,
  DEFAULT_EXAM_CODE,
  type DimensionScore,
  type RubricDimensionKey,
  type RubricKind,
} from "@neev/shared";
import { ESSAY_PAPER_CODE, ESSAY_WORD_LIMIT, ESSAY_MAX_MARKS } from "../../lib/exam-papers.js";

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
  /** Whose mark scheme this encodes. One exam per version — see the header. */
  examCode: string;
  /** GS vs Essay — the board/percentile segmentation axis. */
  kind: RubricKind;
  /** Paper codes selecting this rubric; empty = the exam's default rubric. */
  paperCodes: readonly string[];
  /** Assumed when the question / custom prompt carries no word limit or marks. */
  defaults: { wordLimit: number; maxScore: number };
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
  [RUBRIC_VERSION]: {
    version: RUBRIC_VERSION,
    examCode: DEFAULT_EXAM_CODE,
    kind: "gs",
    paperCodes: [], // UPPSC's default: every Mains paper except the Essay paper.
    defaults: { wordLimit: DEFAULT_WORD_LIMIT, maxScore: DEFAULT_MAX_SCORE },
    dimensions: V1_DIMENSIONS,
  },
  [ESSAY_RUBRIC_VERSION]: {
    version: ESSAY_RUBRIC_VERSION,
    examCode: DEFAULT_EXAM_CODE,
    kind: "essay",
    paperCodes: [ESSAY_PAPER_CODE],
    defaults: { wordLimit: ESSAY_WORD_LIMIT, maxScore: ESSAY_MAX_MARKS },
    dimensions: ESSAY_V1_DIMENSIONS,
  },
};

// Fail fast if any rubric's weights drift from summing to 1.0, or if an exam
// ends up with two default GS rubrics / two rubrics claiming one paper — both
// would make resolveRubric's answer depend on object key order.
{
  const defaultByExam = new Map<string, string>();
  const ownerByPaper = new Map<string, string>();
  for (const def of Object.values(RUBRICS)) {
    const sum = def.dimensions.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`Rubric ${def.version} weights must sum to 1.0, got ${sum}`);
    }
    if (def.paperCodes.length === 0) {
      const prior = defaultByExam.get(def.examCode);
      if (prior) throw new Error(`Exams may have one default rubric: ${def.examCode} has ${prior} and ${def.version}`);
      defaultByExam.set(def.examCode, def.version);
    }
    for (const paper of def.paperCodes) {
      const prior = ownerByPaper.get(paper);
      if (prior) throw new Error(`Paper ${paper} is claimed by two rubrics: ${prior} and ${def.version}`);
      ownerByPaper.set(paper, def.version);
    }
  }
}

/** The rubric for a version, defaulting to v1 for any unknown/legacy value. */
export function getRubric(version: string): RubricDefinition {
  return RUBRICS[version] ?? RUBRICS[RUBRIC_VERSION];
}

/**
 * Which rubric grades an answer, given the exam whose syllabus the question
 * belongs to and (for a catalogued question) its paper code.
 *
 * Falls back to the DEFAULT exam's rubrics when an exam has none registered
 * yet, rather than throwing: a second exam can be ingested and its answers
 * evaluated before someone has authored its mark scheme, and a plausible
 * generic rubric is far better than a 500 at the billing point. The fallback is
 * VISIBLE rather than silent — the persisted `rubric_version` still reads `v1`
 * (UPPSC's scheme), so a query for "answers graded under a foreign scheme" is
 * `exam_code <> the rubric's own examCode`. The evaluation's own `exam_code`
 * stays the answer's exam, so a second exam's users still form their own board
 * instead of being ranked against UPPSC's.
 */
export function resolveRubric(examCode: string, paperCode?: string | null): RubricDefinition {
  const forExam = Object.values(RUBRICS).filter((r) => r.examCode === examCode);
  const pool = forExam.length > 0 ? forExam : Object.values(RUBRICS).filter((r) => r.examCode === DEFAULT_EXAM_CODE);
  if (paperCode) {
    const byPaper = pool.find((r) => r.paperCodes.includes(paperCode));
    if (byPaper) return byPaper;
  }
  return pool.find((r) => r.paperCodes.length === 0) ?? RUBRICS[RUBRIC_VERSION];
}

/**
 * The rubric a user explicitly opted into via `answer_submissions.meta.rubric`
 * (the writing room's essay mode on a non-catalogued topic), scoped to their
 * exam — so a UPSC user asking for "essay" gets UPSC's essay rubric, never
 * UPPSC's. Returns null when the value names no rubric of that kind.
 */
export function resolveRubricByKind(examCode: string, kind: RubricKind): RubricDefinition | null {
  const forExam = Object.values(RUBRICS).filter((r) => r.examCode === examCode && r.kind === kind);
  if (forExam.length > 0) return forExam[0];
  return Object.values(RUBRICS).find((r) => r.examCode === DEFAULT_EXAM_CODE && r.kind === kind) ?? null;
}

/**
 * The persisted `rubric_kind` for a version. Unknown/legacy versions read as
 * "gs" — matching the pre-0109 behaviour, where the GS board was defined as
 * "everything that is not literally essay-v1".
 */
export function rubricKindOf(version: string): RubricKind {
  return RUBRICS[version]?.kind ?? "gs";
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
