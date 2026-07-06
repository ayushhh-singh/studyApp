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
