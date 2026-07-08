import type { MasteryLevel } from "@prayasup/shared";

/** Levels in ascending order, for the map legend. */
export const MASTERY_LEVELS: MasteryLevel[] = ["unseen", "bronze", "silver", "gold", "exam_ready"];

/**
 * Level -> brand colour. Follows the app's weak->strong semantics (coral = weak,
 * up through the score band, to primary blue for fully secured) rather than
 * literal metal hues, so the map reads on the same palette as the Rubric Dial.
 */
export const MASTERY_COLOR: Record<MasteryLevel, string> = {
  unseen: "var(--muted-foreground)",
  bronze: "var(--coral)",
  silver: "var(--marigold)",
  gold: "var(--tulsi)",
  exam_ready: "var(--primary)",
};

/** i18n key for a level's short label (Learn.mastery_bronze, ...). */
export function masteryLevelKey(level: MasteryLevel): string {
  return `Learn.mastery_${level}`;
}

/** Territory fill: a tint of the level colour over the card surface. */
export function masteryTileFill(level: MasteryLevel): string {
  const pct = level === "unseen" ? 12 : 26;
  return `color-mix(in srgb, ${MASTERY_COLOR[level]} ${pct}%, var(--card))`;
}
