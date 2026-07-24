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
import type { MarkingScheme } from "@neev/shared";

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
  paperCode: string;
  includeCurrentAffairs: boolean;
  /** Title stem shown after "Daily Quiz — " ... actually the paper label; see quiz.ts titles. */
  labelI18n: { en: string; hi: string };
  config: DailyQuizConfig;
  /** This variant's attempts feed the competitive daily scoreboard. */
  board: boolean;
}

export const DAILY_QUIZ_VARIANTS: DailyQuizVariant[] = [
  {
    key: "gs",
    paperCode: "PRE_GS1",
    includeCurrentAffairs: true,
    labelI18n: { en: "GS", hi: "जीएस" },
    config: GS_QUIZ_CONFIG,
    board: true,
  },
  {
    key: "csat",
    paperCode: "PRE_CSAT",
    includeCurrentAffairs: false,
    labelI18n: { en: "CSAT", hi: "सीसैट" },
    config: CSAT_QUIZ_CONFIG,
    board: false,
  },
];

/** Back-compat alias: the GS quiz is the direct descendant of the old single blended quiz. */
export const DAILY_QUIZ_CONFIG = GS_QUIZ_CONFIG;

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
