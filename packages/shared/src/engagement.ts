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
