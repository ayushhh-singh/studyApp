import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { rubricDimensionKeySchema } from "./evaluation";

/**
 * `/:locale/profile` analytics bundle — one aggregate endpoint (efficient SQL
 * on the API side) rather than five round-trips, since the whole page loads
 * together. Strength/weakness reuses the existing `GET /mastery` endpoint
 * directly (not duplicated here) since it already encodes "weak AND heavily
 * asked" via `is_priority`.
 */

export const scoreTrajectoryPointSchema = z.object({
  date: z.string(),
  overall_pct: z.number(),
});
export type ScoreTrajectoryPoint = z.infer<typeof scoreTrajectoryPointSchema>;

export const paperScoreTrajectorySchema = z.object({
  paper_code: z.string(),
  paper_title_i18n: bilingualTextSchema,
  points: z.array(scoreTrajectoryPointSchema),
});
export type PaperScoreTrajectory = z.infer<typeof paperScoreTrajectorySchema>;

export const accuracyTimeBucketSchema = z.object({
  bucket_label: z.enum(["<30s", "30-60s", "60-120s", ">120s"]),
  accuracy_pct: z.number(),
  count: z.number().int(),
});
export type AccuracyTimeBucket = z.infer<typeof accuracyTimeBucketSchema>;

export const evaluationTrendPointSchema = z.object({
  date: z.string(),
  submission_id: z.string().uuid(),
  overall_pct: z.number(),
  dimension_pct: z.record(rubricDimensionKeySchema, z.number()),
});
export type EvaluationTrendPoint = z.infer<typeof evaluationTrendPointSchema>;

export const dimensionInsightSchema = z.object({
  dimension_key: rubricDimensionKeySchema,
  recent_avg_pct: z.number(),
  previous_avg_pct: z.number().nullable(),
  delta_pct: z.number().nullable(),
});
export type DimensionInsight = z.infer<typeof dimensionInsightSchema>;

export const improvementProofItemSchema = z.object({
  question_id: z.string().uuid(),
  question_stem_i18n: bilingualTextSchema,
  before_submission_id: z.string().uuid(),
  after_submission_id: z.string().uuid(),
  before_pct: z.number(),
  after_pct: z.number(),
  delta_pct: z.number(),
  before_date: z.string(),
  after_date: z.string(),
});
export type ImprovementProofItem = z.infer<typeof improvementProofItemSchema>;

export const profileAnalyticsSchema = z.object({
  score_trajectory: z.array(paperScoreTrajectorySchema),
  accuracy_time_buckets: z.array(accuracyTimeBucketSchema),
  evaluation_trend: z.array(evaluationTrendPointSchema),
  dimension_insights: z.array(dimensionInsightSchema),
  improvement_proof: z.object({
    items: z.array(improvementProofItemSchema),
    avg_delta_pct: z.number().nullable(),
  }),
});
export type ProfileAnalytics = z.infer<typeof profileAnalyticsSchema>;

export const profileAnalyticsResponseSchema = apiEnvelopeSchema(profileAnalyticsSchema);
export type ProfileAnalyticsResponse = z.infer<typeof profileAnalyticsResponseSchema>;
