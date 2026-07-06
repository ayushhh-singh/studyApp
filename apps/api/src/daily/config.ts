/**
 * Daily-engagement engine configuration — all the tunable ratios/sizes in ONE
 * place so the assembler reads as policy, not magic numbers.
 *
 * Daily quiz: a 20–30 question MCQ set assembled fresh each IST day, mixing
 * generated MCQs on the user's weak topics, spaced-reuse PYQs, this week's
 * current-affairs MCQs, and random coverage. Real UPPSC Prelims one-third
 * negative marking. If a slice can't be filled from its own pool, the assembler
 * backfills from the other pools and logs the shortfall — never shipping a
 * thin quiz.
 */
import type { MarkingScheme } from "@prayasup/shared";

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
  /** Current-affairs items dated within this many days feed the CA slice. */
  currentAffairsDays: number;
  /** A leaf topic with graded accuracy below this is "weak" and targeted by the generated slice. */
  weakAccuracyThreshold: number;
  /** UPPSC Prelims one-third negative marking, stored on the assembled test. */
  markingScheme: MarkingScheme;
}

export const DAILY_QUIZ_CONFIG: DailyQuizConfig = {
  defaultSize: 25,
  minSize: 20,
  maxSize: 30,
  ratios: {
    generated: 0.4,
    pyq: 0.3,
    current_affairs: 0.2,
    random: 0.1,
  },
  pyqRecencyDays: 14,
  currentAffairsDays: 7,
  weakAccuracyThreshold: 0.6,
  markingScheme: {
    type: "uppsc_prelims",
    negative_marking: -0.33,
    note: "one-third (1/3) negative marking",
  },
};

/** The order slices are filled AND the order leftovers are drawn from when backfilling a short slice. */
export const SLICE_FILL_ORDER: QuizSlice[] = ["generated", "pyq", "current_affairs", "random"];

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
