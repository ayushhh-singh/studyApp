/**
 * Daily-engagement engine configuration — all the tunable ratios/sizes in ONE
 * place so the assembler reads as policy, not magic numbers.
 *
 * Daily quiz: split into TWO genuinely separate quizzes per IST day — a GS quiz
 * (PRE_GS1) and a CSAT quiz (PRE_CSAT) — instead of one blended pool. Each is
 * assembled independently from its OWN paper's pool via the same slice
 * machinery (see DAILY_QUIZ_VARIANTS below), with real UPPSC Prelims one-third
 * negative marking. If a slice can't be filled from its own pool, the assembler
 * backfills from that same paper's other pools (never across papers) and logs
 * the shortfall — never shipping a thin quiz.
 *
 * Question-count split (roughly mirrors the real exam's 150:100 GS:CSAT
 * proportion, scaled to a daily-habit size): GS is the merit paper and carries
 * the richer pool (static PYQs/generated + current-affairs), so it's the larger,
 * primary quiz (25/day); CSAT is qualifying-only and has a narrower pool (PYQ +
 * coverage — no current-affairs dimension), so it's the secondary quiz (20/day).
 *
 * "Static" vs "current-affairs" is the classic prelims split. In this codebase
 * the GS static slices are `pyq` (real past static questions), `generated`
 * (AI-authored questions on weak static topics) and `random` (broad coverage
 * across the static PRE_GS1 syllabus) — all scoped to paper PRE_GS1; only the
 * `current_affairs` slice is non-static. The GS mix is deliberately
 * static-heavy (~80%: pyq + generated + random) with a modest current-affairs
 * share, so most of each day's GS quiz comes from static syllabus topics.
 */
import { DEFAULT_EXAM_CODE, type MarkingScheme } from "@neev/shared";
import { PRELIMS_CSAT_PAPER_CODE, PRELIMS_GS1_PAPER_CODE } from "../lib/exam-papers.js";
import { UPSC_EXAM_CODE, UPSC_PRELIMS_CSAT_PAPER_CODE, UPSC_PRELIMS_GS1_PAPER_CODE } from "../lib/upsc-papers.js";

/** The four slices of a daily quiz, in fill priority order. */
export type QuizSlice = "generated" | "pyq" | "current_affairs" | "random";

export interface DailyQuizConfig {
  /** Default question count; clamped to [min, max]. */
  defaultSize: number;
  minSize: number;
  maxSize: number;
  /** Fraction of the quiz drawn from each slice (should sum to ~1.0). */
  ratios: Record<QuizSlice, number>;
  /** A PYQ answered within this many days is "seen recently" and skipped by the pyq slice. */
  pyqRecencyDays: number;
  /**
   * A generated MCQ used in a daily quiz within this many days is skipped by the
   * generated slice — the same anti-repetition rule the pyq slice already applies
   * (previously the generated slice had NO recency exclusion, so its small
   * weak-topic pool recycled every few days: the felt repetition). Defaults to
   * the same window as pyq; kept as its own knob since the generated pool is
   * smaller and may want a different spacing than real PYQs.
   */
  generatedRecencyDays: number;
  /** Current-affairs items dated within this many days feed the CA slice. */
  currentAffairsDays: number;
  /** A leaf topic with graded accuracy below this is "weak" and targeted by the generated slice. */
  weakAccuracyThreshold: number;
  /** UPPSC Prelims one-third negative marking, stored on the assembled test. */
  markingScheme: MarkingScheme;
}

/**
 * Real UPPSC Prelims marking is one-THIRD negative — a FRACTION of each
 * question's own marks, applied by attempts.ts as `negative_marking * marks`.
 * So the same -0.33 fraction is correct for BOTH papers even though a CSAT
 * question is worth 2 marks and a GS question ~1.33: -0.33 × 2 = -0.66 actual
 * deduction on CSAT, -0.33 × 1.33 ≈ -0.44 on GS, both exactly one-third. The
 * per-question marks come from questions.marks, not from this scheme.
 */
const UPPSC_PRELIMS_MARKING: MarkingScheme = {
  type: "uppsc_prelims",
  negative_marking: -0.33,
  note: "one-third (1/3) negative marking",
};

/**
 * UPSC Civil Services Prelims marking. Re-derived from THIS commission's own
 * notified pattern, never adapted from UPPSC's value above.
 *
 * SOURCE: `exams.paper_structure` (migration 0106, verified against the UPSC
 * notification PDF) records `negative_marking = {of: "question_marks",
 * fraction: 0.3333}` for BOTH `UPSC_PRE_GS1` and `UPSC_PRE_CSAT`. Because the
 * schema stores a FRACTION of the question's own marks — exactly the semantics
 * `attempts.ts` applies (`awarded = negative_marking * marks`) — the one value
 * is correct for both papers even though a UPSC GS question is worth 2 marks
 * and a CSAT question 2.5: 0.3333 × 2 = 0.667 and 0.3333 × 2.5 = 0.833, each
 * exactly one third. The per-question marks come from `questions.marks`, not
 * from this scheme.
 *
 * ⚑ It is -0.3333 here and -0.33 in UPPSC's constant above, and that difference
 * is deliberate, not a typo. The registry's fraction for uppsc is ALSO 0.3333,
 * so UPPSC's -0.33 under-deducts by 1% — a pre-existing cosmetic rounding that
 * is frozen because it is already stamped into every daily-quiz row ever built
 * and correcting it would silently reprice the live exam's quizzes. A new exam
 * has no such history, so it starts on the registry's own number.
 *
 * ⚑ KNOWN LIMITATION, inherited and stated rather than hidden: UPSC does not
 * apply negative marking to CSAT *Decision Making* questions. A per-paper
 * scalar cannot express a per-question carve-out (the same note appears on
 * `lib/exam-papers.ts`'s PRELIMS_MARKING), so a decision-making item is
 * penalised here where the real exam would not penalise it.
 */
const UPSC_PRELIMS_MARKING: MarkingScheme = {
  type: "upsc_prelims",
  negative_marking: -0.3333,
  note: "one-third (1/3) negative marking",
};

/**
 * The GS (PRE_GS1) daily quiz — the primary, merit-paper quiz. 25 questions,
 * static-heavy: generated (weak static topics) + pyq (real static PYQs) +
 * random (broad static coverage) = ~80%, with a modest current-affairs share.
 * The `random` slice was raised to 0.2 specifically to guarantee a chunk of
 * each day's quiz is broad static-topic coverage (not only weak-topic-targeted
 * or current-affairs).
 */
export const GS_QUIZ_CONFIG: DailyQuizConfig = {
  defaultSize: 25,
  minSize: 18,
  maxSize: 30,
  ratios: {
    generated: 0.32, // ~8 — AI questions on weak static topics
    pyq: 0.32, // ~8 — real past static questions
    current_affairs: 0.16, // ~4 — this week's current affairs
    random: 0.2, // ~5 — broad coverage across static PRE_GS1 topics
  },
  pyqRecencyDays: 14,
  generatedRecencyDays: 14,
  currentAffairsDays: 7,
  weakAccuracyThreshold: 0.6,
  markingScheme: UPPSC_PRELIMS_MARKING,
};

/**
 * The CSAT (PRE_CSAT) daily quiz — the secondary, qualifying-paper quiz.
 * CSAT is comprehension / reasoning / aptitude, so two of the GS slices simply
 * don't apply: there is no current-affairs dimension, and (essentially) no
 * generated CSAT MCQs. The mix is therefore PYQ-heavy — real past CSAT
 * questions are the gold standard — with random coverage as depth/backfill.
 * Same slice machinery, just with the inapplicable slices set to 0 (a 0-target
 * slice is skipped and its pool becomes pure backfill reservoir).
 */
export const CSAT_QUIZ_CONFIG: DailyQuizConfig = {
  defaultSize: 20,
  minSize: 12,
  maxSize: 25,
  ratios: {
    generated: 0,
    pyq: 0.7,
    current_affairs: 0,
    random: 0.3,
  },
  pyqRecencyDays: 14,
  generatedRecencyDays: 14,
  currentAffairsDays: 7,
  weakAccuracyThreshold: 0.6,
  markingScheme: UPPSC_PRELIMS_MARKING,
};

/**
 * The two daily-quiz variants built each day, in display priority order (GS
 * primary, CSAT secondary). Each is assembled independently against its own
 * paper's question pool; `includeCurrentAffairs` gates the CA slice (GS only —
 * CA is GS content). `board` marks which single variant feeds the competitive
 * daily scoreboard (the GS quiz — see services/scoreboard.ts).
 */
export type DailyQuizPaper = "gs" | "csat";

export interface DailyQuizVariant {
  key: DailyQuizPaper;
  /**
   * Which exam this quiz is for. Explicit rather than derived from `paperCode`:
   * paper codes are globally unique across exams (the §0 invariant), so the
   * derivation would be *correct* but would still leave every read and write in
   * the daily-quiz path filtering on paper alone — which is precisely how two
   * exams' quizzes end up sharing a `.maybeSingle()` lookup and a recency
   * window. Naming the exam here makes it available at all three sites.
   */
  examCode: string;
  paperCode: string;
  includeCurrentAffairs: boolean;
  /** Title stem shown after "Daily Quiz — " ... actually the paper label; see quiz.ts titles. */
  labelI18n: { en: string; hi: string };
  config: DailyQuizConfig;
  /** This variant's attempts feed the competitive daily scoreboard. */
  board: boolean;
}

/**
 * UPSC's two prelims quizzes. The SLICE POLICY (sizes, ratios, recency windows,
 * weak-topic threshold) is deliberately shared with UPPSC's configs above —
 * those are product decisions about a daily study habit, not facts about a
 * commission — while everything that IS a fact about the commission (paper
 * codes, negative marking) is re-derived. Spread rather than re-declared so the
 * two exams cannot silently drift apart on policy.
 *
 * The 25:20 GS:CSAT split happens to fit UPSC even better than UPPSC: UPSC's
 * real papers are 100:80 questions = 1.25, exactly the 25:20 ratio (UPPSC's are
 * 150:100 = 1.5). No re-tuning needed.
 *
 * ⚑ The `generated` slice will run SHORT for UPSC until `qgen:topup --exam upsc`
 * has stocked a bank — there are zero generated MCQs on either UPSC paper today.
 * That is handled, not broken: a short slice logs a shortfall and backfills from
 * the paper's own other pools (see quiz.ts), so the quiz still ships full length,
 * and the ratio becomes real the moment generation runs. Zeroing the ratio here
 * would have to be undone later and would hide the gap in the meantime.
 */
const UPSC_GS_QUIZ_CONFIG: DailyQuizConfig = { ...GS_QUIZ_CONFIG, markingScheme: UPSC_PRELIMS_MARKING };
const UPSC_CSAT_QUIZ_CONFIG: DailyQuizConfig = { ...CSAT_QUIZ_CONFIG, markingScheme: UPSC_PRELIMS_MARKING };

/**
 * Every exam's daily-quiz variants. NOT the build list — `buildDailyQuizzes`
 * takes an explicit exam set and filters this through `variantsForExam`, so
 * adding a non-live exam's variants here does NOT enrol it in the nightly cron
 * (see quiz.ts / run.ts, and the `--exam` override modelled on qgen/cli.ts).
 *
 * The `key` values are reused across exams on purpose: `tests.slug` carries the
 * exam separately for a non-default exam, `DailyQuizPaper` stays a closed
 * two-member union, and `services/daily.ts`'s `{gs, csat}` response shape keeps
 * working unchanged for every exam.
 */
export const DAILY_QUIZ_VARIANTS: DailyQuizVariant[] = [
  {
    key: "gs",
    examCode: DEFAULT_EXAM_CODE,
    paperCode: PRELIMS_GS1_PAPER_CODE,
    includeCurrentAffairs: true,
    labelI18n: { en: "GS", hi: "जीएस" },
    config: GS_QUIZ_CONFIG,
    board: true,
  },
  {
    key: "csat",
    examCode: DEFAULT_EXAM_CODE,
    paperCode: PRELIMS_CSAT_PAPER_CODE,
    includeCurrentAffairs: false,
    labelI18n: { en: "CSAT", hi: "सीसैट" },
    config: CSAT_QUIZ_CONFIG,
    board: false,
  },
  {
    key: "gs",
    examCode: UPSC_EXAM_CODE,
    paperCode: UPSC_PRELIMS_GS1_PAPER_CODE,
    includeCurrentAffairs: true,
    labelI18n: { en: "GS", hi: "जीएस" },
    config: UPSC_GS_QUIZ_CONFIG,
    board: true,
  },
  {
    key: "csat",
    examCode: UPSC_EXAM_CODE,
    paperCode: UPSC_PRELIMS_CSAT_PAPER_CODE,
    includeCurrentAffairs: false,
    labelI18n: { en: "CSAT", hi: "सीसैट" },
    config: UPSC_CSAT_QUIZ_CONFIG,
    board: false,
  },
];

/**
 * The variant one exam builds for one paper, or null. Used by the daily board
 * to answer "is an attempt on THIS test board-eligible?" without re-encoding
 * the answer as a paper-code literal.
 */
export function variantForPaper(examCode: string, paperCode: string): DailyQuizVariant | null {
  return DAILY_QUIZ_VARIANTS.find((v) => v.examCode === examCode && v.paperCode === paperCode) ?? null;
}

/** Back-compat alias: the GS quiz is the direct descendant of the old single blended quiz. */
export const DAILY_QUIZ_CONFIG = GS_QUIZ_CONFIG;

/**
 * The daily-quiz variants configured for one exam — EMPTY for an exam that has
 * no daily quiz yet, which is the honest answer. Returning the default exam's
 * variants as a fallback would serve a UPSC user a UPPSC quiz built from the
 * UPPSC question bank, and record their attempt on the UPPSC daily board.
 */
export function variantsForExam(examCode: string): DailyQuizVariant[] {
  return DAILY_QUIZ_VARIANTS.filter((v) => v.examCode === examCode);
}

/** The order slices are filled AND the order leftovers are drawn from when backfilling a short slice. */
export const SLICE_FILL_ORDER: QuizSlice[] = ["generated", "pyq", "current_affairs", "random"];

// ---------------------------------------------------------------------------
// Daily answer set — 4 GS descriptive questions/day rotating across the six GS
// papers (incl. GS-V/VI UP), plus one weekly ESSAY slot (Sunday). Computed
// deterministically per IST day, so it needs no storage and is stable within a
// day. One completed evaluation from the set maintains the streak.
// ---------------------------------------------------------------------------
export const ANSWER_SET_CONFIG = {
  /** GS descriptive questions per day (a rotating window over the six GS papers). */
  gsPerDay: 4,
  /** IST weekday that carries the weekly essay slot (0 = Sunday). */
  essayWeekday: 0,
};

/**
 * Split `size` into per-slice targets by ratio. Uses largest-remainder rounding
 * so the parts always sum to exactly `size` (no off-by-one from independent
 * Math.round of each ratio).
 */
export function sliceTargets(size: number, ratios: Record<QuizSlice, number>): Record<QuizSlice, number> {
  const raw = SLICE_FILL_ORDER.map((slice) => ({ slice, exact: size * ratios[slice] }));
  const floored = raw.map((r) => ({ ...r, base: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let remaining = size - floored.reduce((s, r) => s + r.base, 0);
  // Hand out the remaining units to the largest fractional parts first.
  const byFrac = [...floored].sort((a, b) => b.frac - a.frac);
  const bonus = new Set<QuizSlice>();
  for (const r of byFrac) {
    if (remaining <= 0) break;
    bonus.add(r.slice);
    remaining -= 1;
  }
  const out = {} as Record<QuizSlice, number>;
  for (const r of floored) out[r.slice] = r.base + (bonus.has(r.slice) ? 1 : 0);
  return out;
}

export function clampSize(size: number, cfg: DailyQuizConfig = DAILY_QUIZ_CONFIG): number {
  return Math.max(cfg.minSize, Math.min(cfg.maxSize, Math.round(size)));
}
