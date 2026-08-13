import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * Achievement milestones + the weekly digest — the reward/summary layer of the
 * daily-engagement engine.
 */
export const milestoneSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  achieved_at: z.string(),
  seen: z.boolean(),
  title_i18n: bilingualTextSchema,
  body_i18n: bilingualTextSchema,
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const milestoneListResponseSchema = apiEnvelopeSchema(z.array(milestoneSchema));
export type MilestoneListResponse = z.infer<typeof milestoneListResponseSchema>;

/**
 * One slot in the profile's badge case — the whole catalogue, earned or not.
 *
 * Distinct from `Milestone` (a row the user actually holds, with an id and a
 * seen flag driving the one-time toast): a Badge is a catalogue ENTRY, so it has
 * no id, and `earned_at: null` is the normal, expected state for most of them.
 * Progress lets the client show how close the next one is without hardcoding a
 * single threshold — those live only in the API's MILESTONE_DEFS.
 */
export const badgeSchema = z.object({
  key: z.string(),
  title_i18n: bilingualTextSchema,
  body_i18n: bilingualTextSchema,
  /** ISO timestamp when earned, or null if still locked. */
  earned_at: z.string().nullable(),
  /** `current` is capped at `target`, so it never reads "4000 / 1000". */
  progress: z.object({ current: z.number().int(), target: z.number().int() }),
});
export type Badge = z.infer<typeof badgeSchema>;

export const badgeCaseResponseSchema = apiEnvelopeSchema(z.array(badgeSchema));
export type BadgeCaseResponse = z.infer<typeof badgeCaseResponseSchema>;

export const milestoneResponseSchema = apiEnvelopeSchema(milestoneSchema);
export type MilestoneResponse = z.infer<typeof milestoneResponseSchema>;

export const weeklyDigestSchema = z.object({
  week_start: z.string(),
  week_end: z.string(),
  questions_attempted: z.number().int(),
  accuracy_pct: z.number().nullable(),
  answers_evaluated: z.number().int(),
  srs_reviews: z.number().int(),
  streak_count: z.number().int(),
});
export type WeeklyDigest = z.infer<typeof weeklyDigestSchema>;

export const weeklyDigestResponseSchema = apiEnvelopeSchema(weeklyDigestSchema);
export type WeeklyDigestResponse = z.infer<typeof weeklyDigestResponseSchema>;

// Activity heatmap + Perfect Days (the full Today checklist done in one IST day).
export const heatmapDaySchema = z.object({
  date: z.string(),
  /** Activity intensity: attempts + SRS reviews + answer submissions + reads that day. */
  count: z.number().int(),
  is_perfect: z.boolean(),
  is_future: z.boolean(),
});
export type HeatmapDay = z.infer<typeof heatmapDaySchema>;

export const activityHeatmapSchema = z.object({
  weeks: z.number().int(),
  days: z.array(heatmapDaySchema),
  perfect_days_total: z.number().int(),
});
export type ActivityHeatmap = z.infer<typeof activityHeatmapSchema>;

export const activityHeatmapResponseSchema = apiEnvelopeSchema(activityHeatmapSchema);
export type ActivityHeatmapResponse = z.infer<typeof activityHeatmapResponseSchema>;

// Leaderboard — built but hidden (no nav entry) until opt-in social features land.
export const leaderboardEntrySchema = z.object({
  rank: z.number().int(),
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  streak_count: z.number().int(),
  questions_attempted: z.number().int(),
  accuracy_pct: z.number().nullable(),
  is_you: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = apiEnvelopeSchema(z.array(leaderboardEntrySchema));
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
