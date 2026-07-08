import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { testDetailSchema } from "./tests";

/**
 * CSAT Time Attack — 10 published CSAT MCQs, a 5:00 countdown, one-tap answers
 * with instant feedback + a combo flame, and a personal best per CSAT node.
 * Reuses the attempt engine (kind='time_attack', no negative marking).
 */
export const TIME_ATTACK_SIZE = 10;
export const TIME_ATTACK_MINUTES = 5;

export const personalBestSchema = z.object({
  syllabus_node_id: z.string().uuid(),
  best_correct: z.number().int(),
  best_total: z.number().int(),
  best_time_seconds: z.number().int().nullable(),
  best_combo: z.number().int(),
  achieved_at: z.string(),
});
export type PersonalBest = z.infer<typeof personalBestSchema>;

export const timeAttackTopicSchema = z.object({
  node_id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  /** Published CSAT MCQs available in this node's subtree. */
  available: z.number().int(),
  /** The CSAT paper root — "All CSAT". */
  is_all_csat: z.boolean(),
  personal_best: personalBestSchema.nullable(),
});
export type TimeAttackTopic = z.infer<typeof timeAttackTopicSchema>;

export const timeAttackTopicsResponseSchema = apiEnvelopeSchema(z.array(timeAttackTopicSchema));
export type TimeAttackTopicsResponse = z.infer<typeof timeAttackTopicsResponseSchema>;

export const timeAttackStartBodySchema = z.object({ node_id: z.string().uuid() });
export type TimeAttackStartBody = z.infer<typeof timeAttackStartBodySchema>;

export const timeAttackStartSchema = z.object({
  attempt_id: z.string().uuid(),
  started_at: z.string(),
  test: testDetailSchema,
  /** question_id -> correct_option_key. Game mode, so the key ships to the client for instant feedback. */
  answer_key: z.record(z.string()),
  node_id: z.string().uuid(),
});
export type TimeAttackStart = z.infer<typeof timeAttackStartSchema>;

export const timeAttackStartResponseSchema = apiEnvelopeSchema(timeAttackStartSchema);
export type TimeAttackStartResponse = z.infer<typeof timeAttackStartResponseSchema>;

export const timeAttackFinishBodySchema = z.object({ combo_best: z.number().int().min(0).default(0) });
export type TimeAttackFinishBody = z.infer<typeof timeAttackFinishBodySchema>;

export const timeAttackResultSchema = z.object({
  this_correct: z.number().int(),
  this_total: z.number().int(),
  this_time_seconds: z.number().int(),
  this_combo: z.number().int(),
  personal_best: personalBestSchema,
  is_new_best: z.boolean(),
});
export type TimeAttackResult = z.infer<typeof timeAttackResultSchema>;

export const timeAttackResultResponseSchema = apiEnvelopeSchema(timeAttackResultSchema);
export type TimeAttackResultResponse = z.infer<typeof timeAttackResultResponseSchema>;
