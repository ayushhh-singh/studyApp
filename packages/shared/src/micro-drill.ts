import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { rubricDimensionKeySchema } from "./evaluation";

/**
 * Micro-drills: short, targeted answer-writing practice against a single
 * rubric dimension (e.g. write ONLY the introduction, scored on
 * structure_flow alone). Deliberately independent of the main evaluation
 * pipeline (evaluation/*) — its own small structuredJson call, so drill
 * scoring can never regress the flagship full evaluation.
 */

export const drillTypeSchema = z.enum(["intro", "conclusion"]);
export type DrillType = z.infer<typeof drillTypeSchema>;

export const drillStatusSchema = z.enum(["pending", "complete"]);
export type DrillStatus = z.infer<typeof drillStatusSchema>;

export const drillItemSchema = z.object({
  question_id: z.string().uuid(),
  question_stem_i18n: bilingualTextSchema,
  word_limit: z.number().int(),
  response_text: z.string().nullable(),
  score: z.number().min(0).max(10).nullable(),
  justification_i18n: bilingualTextSchema.nullable(),
});
export type DrillItem = z.infer<typeof drillItemSchema>;

export const drillSessionSchema = z.object({
  id: z.string().uuid(),
  drill_type: drillTypeSchema,
  dimension_key: rubricDimensionKeySchema,
  status: drillStatusSchema,
  items: z.array(drillItemSchema),
  overall_pct: z.number().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});
export type DrillSession = z.infer<typeof drillSessionSchema>;

export const drillSessionResponseSchema = apiEnvelopeSchema(drillSessionSchema);
export type DrillSessionResponse = z.infer<typeof drillSessionResponseSchema>;

export const drillRecommendationSchema = z.object({
  recommended_type: drillTypeSchema.nullable(),
  weakest_dimension: rubricDimensionKeySchema.nullable(),
  has_enough_data: z.boolean(),
});
export type DrillRecommendation = z.infer<typeof drillRecommendationSchema>;

export const drillRecommendationResponseSchema = apiEnvelopeSchema(drillRecommendationSchema);

export const createDrillBodySchema = z.object({
  drill_type: drillTypeSchema,
});
export type CreateDrillBody = z.infer<typeof createDrillBodySchema>;

export const submitDrillResponsesBodySchema = z.object({
  responses: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        response_text: z.string().min(1).max(600),
      }),
    )
    .min(1),
});
export type SubmitDrillResponsesBody = z.infer<typeof submitDrillResponsesBodySchema>;

export const drillHistoryResponseSchema = apiEnvelopeSchema(z.array(drillSessionSchema));

// SSE events for GET/POST /stream/drills/:id/evaluate
export const drillStatusEventSchema = z.object({ stage: z.string() });
export const drillItemScoreEventSchema = z.object({
  question_id: z.string().uuid(),
  score: z.number(),
  justification_i18n: bilingualTextSchema,
});
export const drillDoneEventSchema = z.object({ session: drillSessionSchema });
export const drillErrorEventSchema = z.object({ message: z.string() });
