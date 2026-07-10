import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * The Scoreboard — Prelims (Daily Quiz / Mocks / Sectionals) + Mains
 * (Answer Writing / Essay / Dimension Bests). Every row is real data: no
 * seeded/fake entries, ever. Rows expose a handle + numbers only (never a
 * user id or display name) — a null handle means the user hasn't set one,
 * rendered as "Anonymous" client-side (see Leaderboard.anonymous).
 */
export const scoreboardRowSchema = z.object({
  rank: z.number().int(),
  handle: z.string().nullable(),
  is_you: z.boolean(),
  score: z.number(),
  accuracy_pct: z.number().nullable(),
  time_taken_seconds: z.number().int().nullable(),
});
export type ScoreboardRow = z.infer<typeof scoreboardRowSchema>;

/** A board's row list is capped (top N) but ALWAYS includes the viewer's own
 * row even if it falls outside that cap — participants is the true total. */
export const scoreboardBoardSchema = z.object({
  rows: z.array(scoreboardRowSchema),
  participants: z.number().int(),
  your_rank: z.number().int().nullable(),
});
export type ScoreboardBoard = z.infer<typeof scoreboardBoardSchema>;

export const dailyQuizTodayBoardSchema = scoreboardBoardSchema.extend({
  date: z.string(),
});
export type DailyQuizTodayBoard = z.infer<typeof dailyQuizTodayBoardSchema>;

export const dailyQuizWeeklyRowSchema = scoreboardRowSchema.extend({
  /** Days this week the user actually took the quiz — the spec's "participation count". */
  days_participated: z.number().int(),
});
export type DailyQuizWeeklyRow = z.infer<typeof dailyQuizWeeklyRowSchema>;

export const dailyQuizWeeklyBoardSchema = z.object({
  week_start: z.string(),
  week_end: z.string(),
  rows: z.array(dailyQuizWeeklyRowSchema),
  participants: z.number().int(),
  your_rank: z.number().int().nullable(),
});
export type DailyQuizWeeklyBoard = z.infer<typeof dailyQuizWeeklyBoardSchema>;

export const testBoardSchema = scoreboardBoardSchema.extend({
  test_id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
});
export type TestBoard = z.infer<typeof testBoardSchema>;

export const scoreboardTestSummarySchema = z.object({
  id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  paper_code: z.string().nullable(),
});
export type ScoreboardTestSummary = z.infer<typeof scoreboardTestSummarySchema>;
export const scoreboardTestListResponseSchema = apiEnvelopeSchema(z.array(scoreboardTestSummarySchema));
export type ScoreboardTestListResponse = z.infer<typeof scoreboardTestListResponseSchema>;

export const mockSeriesRowSchema = scoreboardRowSchema.extend({
  mocks_attempted: z.number().int(),
});
export type MockSeriesRow = z.infer<typeof mockSeriesRowSchema>;

export const mockSeriesBoardSchema = z.object({
  paper_code: z.string(),
  rows: z.array(mockSeriesRowSchema),
  participants: z.number().int(),
  your_rank: z.number().int().nullable(),
});
export type MockSeriesBoard = z.infer<typeof mockSeriesBoardSchema>;

// ---------------------------------------------------------------------------
// Mains — opt-in only (users_profile.show_on_mains_board). A user who hasn't
// opted in (or hasn't cleared the >=3-evaluations-this-week floor) still gets
// their own private stats back, alongside an invitation to opt in — never
// forced onto the public board.
// ---------------------------------------------------------------------------
export const mainsWeeklyStatsSchema = z.object({
  week_start: z.string(),
  evaluations_count: z.number().int(),
  avg_pct: z.number().nullable(),
  qualifies: z.boolean(), // evaluations_count >= 3
});
export type MainsWeeklyStats = z.infer<typeof mainsWeeklyStatsSchema>;

export const mainsWeeklyBoardSchema = z.object({
  week_start: z.string(),
  rows: z.array(scoreboardRowSchema),
  participants: z.number().int(),
  your_rank: z.number().int().nullable(),
  opted_in: z.boolean(),
  your_stats: mainsWeeklyStatsSchema,
});
export type MainsWeeklyBoard = z.infer<typeof mainsWeeklyBoardSchema>;

export const dimensionBestRowSchema = z.object({
  rank: z.number().int(),
  handle: z.string().nullable(),
  is_you: z.boolean(),
  score: z.number(),
});
export type DimensionBestRow = z.infer<typeof dimensionBestRowSchema>;

export const dimensionBestBoardSchema = z.object({
  dimension: z.string(),
  rows: z.array(dimensionBestRowSchema),
});
export type DimensionBestBoard = z.infer<typeof dimensionBestBoardSchema>;

export const dimensionBestsResponseDataSchema = z.object({
  week_start: z.string(),
  opted_in: z.boolean(),
  boards: z.array(dimensionBestBoardSchema),
});
export type DimensionBestsData = z.infer<typeof dimensionBestsResponseDataSchema>;

// ---------------------------------------------------------------------------
// Rank cards — embedded at the moment of the result ("You ranked 4 of 23
// today"), and the private percentile band on the evaluation screen.
// ---------------------------------------------------------------------------
export const rankCardSchema = z.object({
  board_type: z.enum(["daily_quiz", "test"]),
  rank: z.number().int(),
  participants: z.number().int(),
});
export type RankCard = z.infer<typeof rankCardSchema>;

/** Percentile is withheld until participants >= 30 — too small a sample to be meaningful. */
export const evaluationPercentileSchema = z.object({
  eligible: z.boolean(),
  participants: z.number().int(),
  percentile: z.number().nullable(),
});
export type EvaluationPercentile = z.infer<typeof evaluationPercentileSchema>;

// ---------------------------------------------------------------------------
// Profile "my ranks" history sparkline.
// ---------------------------------------------------------------------------
export const rankHistoryPointSchema = z.object({
  snapshot_date: z.string(),
  board_type: z.string(),
  board_key: z.string(),
  rank: z.number().int(),
  participants: z.number().int(),
});
export type RankHistoryPoint = z.infer<typeof rankHistoryPointSchema>;

export const rankHistoryResponseDataSchema = z.object({
  points: z.array(rankHistoryPointSchema),
});
export type RankHistoryData = z.infer<typeof rankHistoryResponseDataSchema>;

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------
export const dailyQuizTodayResponseSchema = apiEnvelopeSchema(dailyQuizTodayBoardSchema);
export const dailyQuizWeeklyResponseSchema = apiEnvelopeSchema(dailyQuizWeeklyBoardSchema);
export const testBoardResponseSchema = apiEnvelopeSchema(testBoardSchema);
export const mockSeriesBoardResponseSchema = apiEnvelopeSchema(mockSeriesBoardSchema);
export const mainsWeeklyBoardResponseSchema = apiEnvelopeSchema(mainsWeeklyBoardSchema);
export const dimensionBestsResponseSchema = apiEnvelopeSchema(dimensionBestsResponseDataSchema);
export const rankCardResponseSchema = apiEnvelopeSchema(rankCardSchema.nullable());
export const evaluationPercentileResponseSchema = apiEnvelopeSchema(evaluationPercentileSchema);
export const rankHistoryResponseSchema = apiEnvelopeSchema(rankHistoryResponseDataSchema);
