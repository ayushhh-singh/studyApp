/**
 * Mastery engine tunables — all thresholds/weights in ONE place so the formula
 * reads as policy, not magic numbers. The exact math is documented for users in
 * /docs/mastery.md; this file is the authoritative source those docs describe.
 *
 * score = round(100 * accuracy * volume * recency), each factor in [0, 1]:
 *   accuracy = correct / attempted                       (graded MCQs on the node's subtree)
 *   volume   = min(1, attempted / VOLUME_TARGET)         (breadth of practice)
 *   recency  = 0.5 ^ (daysSinceLastPractice / HALF_LIFE)  (fades when untouched)
 *
 * The recency factor is why Gold fades to Silver without new practice — it is a
 * pure function of time since the node was last touched, so the score decays on
 * its own. That is honest spaced-repetition logic wearing a game skin.
 */
export interface MasteryConfig {
  /** Graded questions in a node's subtree for full volume credit. */
  volumeTarget: number;
  /** Days for the recency factor to halve (30-day decay). */
  recencyHalfLifeDays: number;
  /** Minimum score (0-100) for each level; checked highest-first. */
  levelThresholds: { exam_ready: number; gold: number; silver: number; bronze: number };
}

export const MASTERY_CONFIG: MasteryConfig = {
  volumeTarget: 15,
  recencyHalfLifeDays: 30,
  levelThresholds: {
    exam_ready: 80,
    gold: 60,
    silver: 35,
    bronze: 1,
  },
};

export type MasteryLevelName = "unseen" | "bronze" | "silver" | "gold" | "exam_ready";

/** Days between two `YYYY-MM-DD`/ISO instants (fractional), never negative. */
export function daysSince(fromIso: string, now: number = Date.now()): number {
  return Math.max(0, (now - Date.parse(fromIso)) / (24 * 3600 * 1000));
}

export function recencyFactor(daysSinceLast: number, cfg: MasteryConfig = MASTERY_CONFIG): number {
  return Math.pow(0.5, daysSinceLast / cfg.recencyHalfLifeDays);
}

export function volumeFactor(attempted: number, cfg: MasteryConfig = MASTERY_CONFIG): number {
  return Math.min(1, attempted / cfg.volumeTarget);
}

/** The 0-100 mastery score from the three factors. */
export function masteryScore(
  correct: number,
  attempted: number,
  daysSinceLast: number,
  cfg: MasteryConfig = MASTERY_CONFIG,
): number {
  if (attempted <= 0) return 0;
  const accuracy = correct / attempted;
  const score = 100 * accuracy * volumeFactor(attempted, cfg) * recencyFactor(daysSinceLast, cfg);
  return Math.round(score * 100) / 100;
}

export function masteryLevel(
  score: number,
  attempted: number,
  cfg: MasteryConfig = MASTERY_CONFIG,
): MasteryLevelName {
  if (attempted <= 0) return "unseen";
  const t = cfg.levelThresholds;
  if (score >= t.exam_ready) return "exam_ready";
  if (score >= t.gold) return "gold";
  if (score >= t.silver) return "silver";
  if (score >= t.bronze) return "bronze";
  return "unseen";
}
