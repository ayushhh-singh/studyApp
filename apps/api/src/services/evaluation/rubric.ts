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
 *  - "upsc-gs-v1"     — UPSC's general Mains descriptive-answer rubric
 *    (GS-I..III; 10 marks/150 words and 15 marks/250 words in near-equal
 *    measure, so 10/150 is the default assumption).
 *  - "upsc-essay-v1"  — the UPSC Essay paper: ~1200 words for 125 marks, one of
 *    the two essays that make up the 250-mark paper.
 *  - "upsc-ethics-v1" — UPSC GS Paper IV (Ethics, Integrity and Aptitude). The
 *    ONE paper UPSC's own notification describes as testing "attitude and
 *    approach" rather than a topic list, which is why it needs its own weights
 *    and its own reading of `examples_data` — see the block above its
 *    dimensions for the full evidence and the one-variant-not-two decision.
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
import { getExamConfig, requireAuthored } from "../../lib/exam-config.js";
import { ESSAY_PAPER_CODE, ESSAY_WORD_LIMIT, ESSAY_MAX_MARKS } from "../../lib/exam-papers.js";
import {
  UPSC_EXAM_CODE,
  UPSC_ESSAY_PAPER_CODE,
  UPSC_ETHICS_PAPER_CODE,
} from "../../lib/upsc-papers.js";

export { RUBRIC_VERSION, ESSAY_RUBRIC_VERSION };

/**
 * The substantiation examples named in a GS rubric's `examples_data` description
 * are the SAME string as `evaluation.substantiationExamples` in
 * lib/exam-config.ts (the model-answer prompt interpolates it too). Read it
 * rather than keep a parallel copy, so the two cannot drift.
 *
 * FIXED 2026-07-31: these used to be module constants pinned to
 * `DEFAULT_EXAM_CODE`, so EVERY rubric's dimension descriptions read UPPSC's
 * "UP-specific data" no matter which exam the rubric belonged to — a second
 * exam's GS rubric would have told its examiner to look for state-specific
 * evidence for a national exam. Each rubric now reads its OWN `examCode`.
 */
function substantiationFor(examCode: string): string {
  return requireAuthored(
    getExamConfig(examCode).evaluation.substantiationExamples,
    examCode,
    "evaluation.substantiationExamples",
  );
}

/**
 * Same rationale for an essay rubric's `examples_data`, which names the
 * substantiation in a different grammatical form. It is the same string as
 * `evaluation.essaySubstantiationExamples`, which the model-answer ESSAY prompt
 * also interpolates.
 */
function essaySubstantiationFor(examCode: string): string {
  return requireAuthored(
    getExamConfig(examCode).evaluation.essaySubstantiationExamples,
    examCode,
    "evaluation.essaySubstantiationExamples",
  );
}

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

/**
 * Which MODEL-ANSWER prompt an answer graded under this rubric should be shown
 * (`buildModelAnswerSystem`). Server-only prompt routing — deliberately NOT the
 * same axis as `kind`:
 *
 *   `kind` is PERSISTED (`evaluations.rubric_kind`, a DB CHECK admitting only
 *   'gs' | 'essay') and is the BOARD segmentation axis. It cannot express
 *   "ethics" without a migration, and widening it would change
 *   `mv_mains_weekly_board`'s segmentation — GS-IV must keep competing on the GS
 *   board.
 *
 *   `modelAnswerShape` is in-memory only and answers a different question:
 *   "which model answer would score near-full marks under THIS rubric?"
 *
 * ADDED 2026-07-31 (docs/OUTSTANDING.md §8f M35). Before it, pass 2 branched on
 * `kind`, so `upsc-ethics-v1` — deliberately `kind: "gs"` — took the GS branch
 * and told the candidate to substantiate with "constitutional articles,
 * committees, schemes, and national and international evidence (Economic Survey
 * and NITI Aayog data, global indices…)" while the rubric it had JUST been
 * scored against says that dimension "is NOT about statistics, citations or
 * data… do not penalise an answer merely for citing few facts". Pass 1 scored
 * realism and practicability; pass 2 handed the candidate a data-heavy model to
 * imitate. A third shape fixes that without touching the persisted axis.
 */
export type ModelAnswerShape = "gs" | "essay" | "ethics";

export interface RubricDefinition {
  version: string;
  /** Whose mark scheme this encodes. One exam per version — see the header. */
  examCode: string;
  /** GS vs Essay — the board/percentile segmentation axis. */
  kind: RubricKind;
  /** Which model-answer prompt pass 2 writes. See `ModelAnswerShape`. */
  modelAnswerShape: ModelAnswerShape;
  /** Paper codes selecting this rubric; empty = the exam's default rubric. */
  paperCodes: readonly string[];
  /** Assumed when the question / custom prompt carries no word limit or marks. */
  defaults: { wordLimit: number; maxScore: number };
  /** Ordered so pass-1 output and the SSE `dimension_score` events keep one order. */
  dimensions: readonly RubricDimension[];
}

// ---------------------------------------------------------------------------
// The general Mains descriptive-answer dimension set. The prose is generic
// answer-writing rubric semantics (structure / coverage / vocabulary /
// substantiation / layout / length), so it is shared across exams; the one
// exam-bearing part is the substantiation list, which is exactly why that lives
// in exam-config. `v1` is the default exam's instance; `upsc-gs-v1` is UPSC's.
// ---------------------------------------------------------------------------
function gsDimensions(examCode: string): readonly RubricDimension[] {
  const substantiation = substantiationFor(examCode);
  return [
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
        `Claims are substantiated with concrete facts, figures, ${substantiation}, committees ` +
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
}

// ---------------------------------------------------------------------------
// The Essay-paper dimension set. Shared prose again; the two exam-bearing parts
// are the substantiation list and the word limit named in the language
// dimension — UPPSC sets one ~700-word essay for 50 marks, UPSC two ~1200-word
// essays for 125 marks each, so a hardcoded "~700-word" would be flatly wrong
// for UPSC. The official-directive quotations are UPPSC's own phrasing of a
// universal essay-marking instruction and read correctly for either paper.
// ---------------------------------------------------------------------------
function essayDimensions(examCode: string, wordLimit: number): readonly RubricDimension[] {
  const essaySubstantiation = essaySubstantiationFor(examCode);
  return [
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
        `quotations, historical references, and ${essaySubstantiation} — not unsupported ` +
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
        `Stays close to the ~${wordLimit}-word limit and is written concisely with effective and exact ` +
        "expression — clear, grammatical, precise, and engaging language, the official mark of " +
        "credit for the essay.",
    },
  ];
}

/*
 * UPSC's paper codes used to be local literals here (M31), because the canonical
 * list lives in the hand-authored syllabus seed and `lib/exam-papers.ts` is
 * UPPSC's own constants module. RESOLVED 2026-07-31: they now come from
 * `lib/upsc-papers.ts`, UPSC's sibling constants module — see its header for the
 * order of authority (seed + migration 0112 win) and for why it carries paper
 * CODES only. The word limits and max marks below stay here on purpose: they are
 * this rubric's `defaults`, not paper structure (see the header's `defaults` note).
 */

/** One UPSC essay: ~1200 words for 125 marks (the paper sets two, for 250). */
const UPSC_ESSAY_WORD_LIMIT = 1200;
const UPSC_ESSAY_MAX_MARKS = 125;

/**
 * UPSC GS-I..III defaults: 10 marks / 150 words and 15 marks / 250 words occur
 * in near-equal measure (~45%/45% of the ingested corpus), so the 10/150 pair is
 * the conservative assumption when a question carries none.
 */
const UPSC_GS_WORD_LIMIT = 150;
const UPSC_GS_MAX_SCORE = 10;

/** GS-IV Section-B case studies are 20 marks / 250 words; 77.9% of the
 * ingested GS-IV corpus is 20-mark. Section-A theory items are 10/150 and carry
 * their own marks on the question row, so this default only fills the gap. */
const UPSC_ETHICS_WORD_LIMIT = 250;
const UPSC_ETHICS_MAX_MARKS = 20;

// Per-exam instances of the two shared sets. Built once at module load, so a
// missing/UNAUTHORED config slot is a loud startup failure naming the field
// rather than a surprise at the first billed evaluation.
const V1_DIMENSIONS = gsDimensions(DEFAULT_EXAM_CODE);
const ESSAY_V1_DIMENSIONS = essayDimensions(DEFAULT_EXAM_CODE, ESSAY_WORD_LIMIT);
const UPSC_GS_DIMENSIONS = gsDimensions(UPSC_EXAM_CODE);
const UPSC_ESSAY_DIMENSIONS = essayDimensions(UPSC_EXAM_CODE, UPSC_ESSAY_WORD_LIMIT);

// ---------------------------------------------------------------------------
// upsc-ethics-v1 — UPSC GS Paper IV (Ethics, Integrity and Aptitude)
// ---------------------------------------------------------------------------
/**
 * WHY GS-IV GETS ITS OWN RUBRIC AT ALL — the load-bearing fact is UPSC's own
 * notification, which describes GS-IV and describes no other paper:
 *
 *   "This paper will include questions to test the candidates' attitude and
 *    approach to issues relating to integrity, probity in public life and his
 *    problem solving approach to various issues and conflicts faced by him in
 *    dealing with society. Questions may utilise the case study approach to
 *    determine these aspects."
 *
 * GS-I..III, the Essay and the Optionals are pure topic lists. GS-IV alone is
 * described by the commission as testing DISPOSITION AND JUDGMENT rather than a
 * checkable body of knowledge, so grading it on the standard GS rubric — which
 * weights substantiation with committees, data and judgments at 15% — measures
 * the wrong thing.
 *
 * WHY ONE VARIANT AND NOT TWO (theory vs case study). The research that produced
 * this rubric recommended splitting it, and that recommendation is DELIBERATELY
 * not followed:
 *  1. The registry's load-time assertion forbids two rubrics claiming the same
 *     `paperCodes` entry, and `paperCodes` is its only per-paper mechanism — two
 *     sub-variants would both claim `UPSC_MAINS_GS4`.
 *  2. Splitting them needs a PER-QUESTION discriminator, and the proposed
 *     heuristic is explicitly a hypothesis rather than a measurement, with an
 *     estimated 10-15% error on the 20-mark subset. Silently routing an answer
 *     to a different marking scheme on an unvalidated heuristic is worse than
 *     one variant.
 *  3. A better mechanism already exists. These `description` fields are PROSE
 *     READ BY THE EXAMINER MODEL, which sees the actual question text — so each
 *     one below is written CONDITIONALLY ("if the question is a short
 *     definitional or quotation item… if it is a narrative case study…"). The
 *     model discriminates from the real text, which beats a regex.
 *
 * FOLLOW-UP if the split is ever wanted: there is NO ground-truth case-study
 * tagging to validate a discriminator against — it would have to be created
 * first. CORRECTED 2026-07-31: an earlier draft of this note claimed the corpus
 * "already carries ground-truth case-study tagging" with "~50-100 already tagged
 * 20-markers". Measured, that is false. All 131 `UPSC_MAINS_GS4` rows carry
 * `meta` with exactly one key (`source_ref`, e.g. "upsc_mains_2025_gs4#q4") and
 * `generation_meta` NULL on 131/131; a needle scan for every plausible tag name
 * (case_study / question_shape / variant / sub_type / section / …) finds none.
 * The "51% case-study-shaped" figure below came from a REGEX OVER STEM TEXT, not
 * a stored tag — which is exactly the unvalidated heuristic point 2 above refuses
 * to ship on. So: hand-label a sample first, then validate, then ship — do not
 * ship the estimate, and do not go looking for a tag that has never existed.
 *
 * MEASURED from our own 2,791-row UPSC PYQ corpus: 10-mark GS-IV questions
 * (n=20) are median 25 words and 0% case-study-shaped; 20-markers (n=102) are
 * median 141 words and 51% case-study-shaped, up to 637 words; 71.8% carry
 * (a)/(b) sub-parts. Real papers split 13 × 10 marks = 130 (Section A) and
 * 6 × 20 marks = 120 (Section B), reconstructed from five actual papers
 * 2019-2024 — NOT the widely cited "125/125", which matches no printed paper.
 *
 * The "options → merits/demerits → recommend" arc is a COACHING TEMPLATE, not a
 * universal demand: roughly half of real case studies ask something structurally
 * different (evaluate a third party's conduct; diagnose and suggest measures;
 * a direct first-person response naming the traits involved; or even a factual
 * sub-part bolted onto a scenario — 2023's Joint-Secretary case asks the
 * candidate to "briefly describe at least four laws"). A rubric that hard-coded
 * the arc would systematically mis-score about half the corpus, so the
 * structure dimension below rewards the arc only WHERE THE QUESTION ASKS FOR IT.
 *
 * WEIGHTS — blended from the two researched profiles rather than averaged
 * blindly, and each value is one of the two profiles' own numbers or their
 * midpoint, so nothing here is invented:
 *   structure_flow      .20  midpoint of theory .15 / case .25
 *   content_coverage    .25  both profiles agree
 *   keywords_concepts   .20  the HIGHER (theory) value — ethical terminology is
 *                            the one thing both formats reward
 *   examples_data       .10  the LOWER (case) value — see below
 *   presentation        .10  both profiles agree
 *   word_limit_language .15  both profiles agree
 * Sum = 1.00 exactly (asserted at load).
 *
 * `examples_data` is deliberately DE-EMPHASISED (.15 → .10) and REDEFINED: for
 * GS-IV it means the realism and administrative plausibility of the
 * illustration, option or resolution, explicitly NOT statistics or citations.
 * The strongest evidence available on what actually earns marks here is
 * VisionIAS's analysis of Aditya Srivastava's real GS-IV script (AIR-1 2023,
 * 143/250 = 57.2%): examiners rewarded "conceptual clarity over data
 * accumulation" and "practical, logical reasoning over statistics", with
 * "notably absent: heavy reliance on citations or statistical evidence". That is
 * coaching-sourced and n=1 — the best available evidence, not a systematic
 * sample, and recorded here as such.
 */
const ETHICS_DIMENSIONS: readonly RubricDimension[] = [
  {
    key: "structure_flow",
    label: "Structure & Problem-Solving Approach",
    weight: 0.2,
    description:
      "Judge the shape the QUESTION actually asks for, not a memorised template. If it is a " +
      "narrative case study, the answer should establish the facts and the ethical issues at " +
      "stake, then respond in whatever form is demanded — weighing options against their merits " +
      "and demerits before recommending one, OR evaluating another party's conduct, OR " +
      "diagnosing a situation and proposing measures, OR answering in the first person as the " +
      "officer — and close with a defensible, actionable position. Only require the " +
      "options-then-recommendation arc where the question asks for a course of action; about " +
      "half of real case studies do not. If it is a short definitional, quotation or " +
      "'what do you understand by' item, expect a crisp definition, an unpacking, and an " +
      "illustration, not a case-study scaffold. Sub-parts labelled (a)/(b) must each be answered " +
      "and answered separately.",
  },
  {
    key: "content_coverage",
    label: "Coverage of the Ethical Demands",
    weight: 0.25,
    description:
      "Every demand the question makes is addressed. For a case study that means all the " +
      "stakeholders and the interests genuinely in tension, the competing values or duties that " +
      "create the dilemma, the legal or institutional constraints in play, and the consequences " +
      "of the course chosen — plus any explicitly bolted-on sub-part (a named number of " +
      "provisions, laws, or measures) actually delivered in full. For a theory item it means the " +
      "concept explained in its own terms and in its administrative context. The most heavily " +
      "weighted dimension.",
  },
  {
    key: "keywords_concepts",
    label: "Ethical Concepts & Vocabulary",
    weight: 0.2,
    description:
      "Correct and precise use of ethical and administrative vocabulary — integrity, probity, " +
      "objectivity, impartiality, conflict of interest, accountability, emotional intelligence, " +
      "conscience, foundational values of civil service — and of the ethical frameworks " +
      "(deontological, consequentialist, virtue-based) where they genuinely illuminate the " +
      "question. Reward conceptual clarity and correct application; do NOT reward name-dropping " +
      "a philosopher or a framework that does no work in the answer. Weighted above the standard " +
      "GS rubric because this paper tests exactly this.",
  },
  {
    key: "examples_data",
    label: "Realism & Practicability",
    weight: 0.1,
    description:
      "For this paper alone, this dimension is NOT about statistics, citations or data. Judge " +
      "whether the illustration, the options considered, or the recommended resolution is " +
      "REALISTIC and ADMINISTRATIVELY PLAUSIBLE — something an officer in that post could " +
      "actually do, within the powers and constraints available, with the consequences honestly " +
      "faced. A concrete real-world or plausible hypothetical example, or a lived administrative " +
      "detail, earns credit; a moralising abstraction does not. Deliberately weighted BELOW the " +
      "standard GS rubric: on this paper examiners reward practical, logical reasoning over " +
      "accumulated data, so do not penalise an answer merely for citing few facts.",
  },
  {
    key: "presentation",
    label: "Presentation",
    weight: 0.1,
    description:
      "Readable organisation: helpful headings or labelled parts where they aid clarity (a " +
      "stakeholder list, an options table in prose form, clearly separated (a)/(b) answers). " +
      "Credit a diagram or flowchart only if the candidate explicitly states they have drawn one " +
      "(this is typed text — none is visible).",
  },
  {
    key: "word_limit_language",
    label: "Word Limit & Language",
    weight: 0.15,
    description:
      "The answer respects the word limit — neither padded far beyond it nor too thin to earn " +
      "the marks — and the language is clear, grammatical and exam-appropriate. On this paper " +
      "also judge TONE: a balanced, non-preachy, professionally detached register that reasons " +
      "rather than sermonises is what an examiner credits.",
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
    modelAnswerShape: "gs",
    paperCodes: [], // UPPSC's default: every Mains paper except the Essay paper.
    defaults: { wordLimit: DEFAULT_WORD_LIMIT, maxScore: DEFAULT_MAX_SCORE },
    dimensions: V1_DIMENSIONS,
  },
  [ESSAY_RUBRIC_VERSION]: {
    version: ESSAY_RUBRIC_VERSION,
    examCode: DEFAULT_EXAM_CODE,
    kind: "essay",
    modelAnswerShape: "essay",
    paperCodes: [ESSAY_PAPER_CODE],
    defaults: { wordLimit: ESSAY_WORD_LIMIT, maxScore: ESSAY_MAX_MARKS },
    dimensions: ESSAY_V1_DIMENSIONS,
  },
  "upsc-gs-v1": {
    version: "upsc-gs-v1",
    examCode: UPSC_EXAM_CODE,
    kind: "gs",
    modelAnswerShape: "gs",
    paperCodes: [], // UPSC's default: every Mains paper except Essay and GS-IV.
    defaults: { wordLimit: UPSC_GS_WORD_LIMIT, maxScore: UPSC_GS_MAX_SCORE },
    dimensions: UPSC_GS_DIMENSIONS,
  },
  "upsc-essay-v1": {
    version: "upsc-essay-v1",
    examCode: UPSC_EXAM_CODE,
    kind: "essay",
    modelAnswerShape: "essay",
    paperCodes: [UPSC_ESSAY_PAPER_CODE],
    defaults: { wordLimit: UPSC_ESSAY_WORD_LIMIT, maxScore: UPSC_ESSAY_MAX_MARKS },
    dimensions: UPSC_ESSAY_DIMENSIONS,
  },
  // kind is "gs", NOT a third kind: GS-IV IS a General Studies paper and must
  // compete on the GS board. `evaluations.rubric_kind` is a DB CHECK-constrained
  // column admitting only 'gs' | 'essay', so a third kind would need a migration
  // AND would change mv_mains_weekly_board's segmentation.
  //
  // `modelAnswerShape` is where the difference belongs instead — it is in-memory
  // prompt routing, so pass 2 can write an ethics model answer without the
  // persisted board axis learning a third value (M35).
  "upsc-ethics-v1": {
    version: "upsc-ethics-v1",
    examCode: UPSC_EXAM_CODE,
    kind: "gs",
    modelAnswerShape: "ethics",
    paperCodes: [UPSC_ETHICS_PAPER_CODE],
    defaults: { wordLimit: UPSC_ETHICS_WORD_LIMIT, maxScore: UPSC_ETHICS_MAX_MARKS },
    dimensions: ETHICS_DIMENSIONS,
  },
};

// Fail fast if any rubric's weights drift from summing to 1.0, or if an exam
// ends up with two default GS rubrics / two rubrics claiming one paper — both
// would make resolveRubric's answer depend on object key order.
{
  const defaultByExam = new Map<string, RubricDefinition>();
  const ownerByPaper = new Map<string, string>();
  const byExam = new Map<string, RubricDefinition[]>();
  for (const def of Object.values(RUBRICS)) {
    const sum = def.dimensions.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`Rubric ${def.version} weights must sum to 1.0, got ${sum}`);
    }
    if (def.paperCodes.length === 0) {
      const prior = defaultByExam.get(def.examCode);
      if (prior) throw new Error(`Exams may have one default rubric: ${def.examCode} has ${prior.version} and ${def.version}`);
      defaultByExam.set(def.examCode, def);
    }
    for (const paper of def.paperCodes) {
      const prior = ownerByPaper.get(paper);
      if (prior) throw new Error(`Paper ${paper} is claimed by two rubrics: ${prior} and ${def.version}`);
      ownerByPaper.set(paper, def.version);
    }
    byExam.set(def.examCode, [...(byExam.get(def.examCode) ?? []), def]);
  }

  // ADDED 2026-07-31 (docs/OUTSTANDING.md §8f M36). `resolveRubricByKind` used to
  // return the FIRST match in declaration order, and for ("upsc", "gs") BOTH
  // `upsc-gs-v1` and `upsc-ethics-v1` match — so reordering the RUBRICS literal
  // would silently have routed a custom-prompt UPSC GS answer to the ethics
  // scheme. The resolver now prefers the exam's DEFAULT rubric (at most one per
  // exam, asserted above), which makes the ambiguous case deterministic AND
  // correct: a custom prompt names no paper, and a paper-selected rubric should
  // only ever be reached BY its paper.
  //
  // That leaves exactly one residual ambiguity to close here: when an exam's
  // default is of a DIFFERENT kind than the one asked for, the answer is whatever
  // paper-selected rubric of that kind exists — so assert there is only one. (A
  // second exam with two essay papers and two essay rubrics is the shape that
  // would trip this; it would then need an explicit rule, not a key order.)
  for (const [examCode, defs] of byExam) {
    const dflt = defaultByExam.get(examCode);
    for (const kind of new Set(defs.map((d) => d.kind))) {
      if (dflt && dflt.kind === kind) continue; // the default wins — deterministic.
      const candidates = defs.filter((d) => d.kind === kind);
      if (candidates.length > 1) {
        throw new Error(
          `resolveRubricByKind(${examCode}, ${kind}) is ambiguous: ` +
            `${candidates.map((c) => c.version).join(", ")} all match and none is the exam's default rubric`,
        );
      }
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
 * The one rubric of a given kind that an exam is represented by when NO paper is
 * named. Prefers the exam's DEFAULT rubric (empty `paperCodes`) — see the
 * load-time assertion block for why that preference is both deterministic and
 * correct, and for the residual case it asserts away.
 */
function pickByKind(pool: readonly RubricDefinition[], kind: RubricKind): RubricDefinition | null {
  const ofKind = pool.filter((r) => r.kind === kind);
  if (ofKind.length === 0) return null;
  // At most one default per exam, and at most one candidate when the default is
  // of another kind — both asserted at load, so this is order-independent.
  return ofKind.find((r) => r.paperCodes.length === 0) ?? ofKind[0];
}

/**
 * The rubric a user explicitly opted into via `answer_submissions.meta.rubric`
 * (the writing room's essay mode on a non-catalogued topic), scoped to their
 * exam — so a UPSC user asking for "essay" gets UPSC's essay rubric, never
 * UPPSC's. Returns null when the value names no rubric of that kind.
 *
 * FIXED 2026-07-31 (M36): this used to return `forExam[0]`, i.e. whichever
 * matching rubric happened to be declared first in the `RUBRICS` literal.
 */
export function resolveRubricByKind(examCode: string, kind: RubricKind): RubricDefinition | null {
  const all = Object.values(RUBRICS);
  return (
    pickByKind(all.filter((r) => r.examCode === examCode), kind) ??
    pickByKind(all.filter((r) => r.examCode === DEFAULT_EXAM_CODE), kind)
  );
}

/**
 * The persisted `rubric_kind` for a version. Unknown/legacy versions read as
 * "gs" — matching the pre-0109 behaviour, where the GS board was defined as
 * "everything that is not literally essay-v1".
 */
export function rubricKindOf(version: string): RubricKind {
  return RUBRICS[version]?.kind ?? "gs";
}

/**
 * Which model-answer prompt pass 2 should write for a version. Unknown/legacy
 * versions read as "gs" — the same fallback `rubricKindOf` makes, and the same
 * one `buildModelAnswerSystem` had before the shape existed.
 */
export function modelAnswerShapeOf(version: string): ModelAnswerShape {
  return RUBRICS[version]?.modelAnswerShape ?? "gs";
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
 * The most heavily weighted dimensions of a rubric — the "biggest score levers"
 * the improvements prompt tells the model to prioritise.
 *
 * ADDED 2026-07-31 (docs/OUTSTANDING.md §8f M30). `buildImprovementsSystem` used
 * to ASSERT a fixed pair ("content coverage and examples/data carry the most
 * weight"). Measured against the registry, that sentence was wrong for THREE of
 * the five rubrics, including the live UPPSC default — it is not a new-exam
 * mismatch but a pre-existing correctness bug:
 *
 *   v1 / upsc-gs-v1   coverage .30, structure .20, keywords .15, EXAMPLES .15  → joint-3rd
 *   essay-v1 / upsc-essay-v1  coverage .30, structure .20, EXAMPLES .20        → joint-2nd
 *   upsc-ethics-v1    coverage .25, structure .20, keywords .20, EXAMPLES .10  → LOWEST
 *
 * THE RULE, stated so it is not "improved" into something non-deterministic:
 * sort by weight descending — `Array.prototype.sort` is stable, so declaration
 * order breaks ties — then take everything at or above the SECOND-highest
 * weight. Ties at the cutoff are INCLUDED rather than truncated to two, because
 * dropping one of two equally weighted dimensions would be an arbitrary choice
 * presented to the model as a ranking (`essay-v1` is exactly that case: structure
 * and examples are both .20).
 *
 * DEGENERATE CUTS RETURN EMPTY (added 2026-07-31, §8f M37). The rule above can
 * select EVERY dimension when the second-highest weight is also the lowest —
 * `[.50,.10,.10,.10,.10,.10]` names 6 of 6, and an all-equal rubric names 6 of 6
 * at 17% each, summing to 102%. The caller's sentence is "…weights X, Y above
 * the rest", so naming everything claims a ranking over an empty remainder.
 * Rather than TRUNCATE — which would make exactly the arbitrary choice the
 * paragraph above refuses to make — the selection must be a PROPER SUBSET or the
 * function returns `[]`, and `buildImprovementsSystem` falls back to a phrasing
 * that names no dimensions. Not reachable by any registered rubric (the widest
 * real cut is 3 of 6); this is a guard against a future re-weighting, and it
 * leaves all five rubrics' output byte-identical.
 */
export function topWeightedDimensions(version: string): readonly RubricDimension[] {
  const sorted = [...getRubric(version).dimensions].sort((a, b) => b.weight - a.weight);
  if (sorted.length < 2) return [];
  const cutoff = sorted[1].weight;
  const top = sorted.filter((d) => d.weight >= cutoff);
  return top.length < sorted.length ? top : [];
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
