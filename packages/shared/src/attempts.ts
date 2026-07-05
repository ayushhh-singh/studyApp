import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { questionOptionSchema } from "./questions";
import { testKindSchema } from "./tests";

export const attemptStartBodySchema = z
  .object({
    test_id: z.string().uuid().optional(),
    question_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  })
  .refine((d) => !!d.test_id || !!d.question_ids, {
    message: "Provide either test_id or question_ids",
  });
export type AttemptStartBody = z.infer<typeof attemptStartBodySchema>;

export const attemptAnswerInputSchema = z.object({
  question_id: z.string().uuid(),
  chosen_option_key: z.string().nullable().optional(),
  time_spent_seconds: z.number().int().nonnegative().optional(),
});
export type AttemptAnswerInput = z.infer<typeof attemptAnswerInputSchema>;

export const attemptAnswersBodySchema = z.object({
  answers: z.array(attemptAnswerInputSchema).min(1),
});
export type AttemptAnswersBody = z.infer<typeof attemptAnswersBodySchema>;

export const attemptSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  test_id: z.string().uuid().nullable(),
  started_at: z.string(),
  submitted_at: z.string().nullable(),
  score: z.number().nullable(),
  total: z.number().nullable(),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const attemptResultItemSchema = z.object({
  question_id: z.string().uuid(),
  chosen_option_key: z.string().nullable(),
  correct_option_key: z.string().nullable(),
  is_correct: z.boolean().nullable(),
  marks_awarded: z.number(),
  explanation_i18n: bilingualTextSchema.nullable(),
});
export type AttemptResultItem = z.infer<typeof attemptResultItemSchema>;

export const attemptSubmitResultSchema = z.object({
  attempt: attemptSchema,
  results: z.array(attemptResultItemSchema),
});
export type AttemptSubmitResult = z.infer<typeof attemptSubmitResultSchema>;

export const attemptResponseSchema = apiEnvelopeSchema(attemptSchema);
export type AttemptResponse = z.infer<typeof attemptResponseSchema>;

export const attemptAnswerRecordSchema = z.object({
  question_id: z.string().uuid(),
  chosen_option_key: z.string().nullable(),
  time_spent_seconds: z.number().int().nullable(),
});
export type AttemptAnswerRecord = z.infer<typeof attemptAnswerRecordSchema>;

export const attemptDetailSchema = z.object({
  attempt: attemptSchema,
  answers: z.array(attemptAnswerRecordSchema),
});
export type AttemptDetail = z.infer<typeof attemptDetailSchema>;

export const attemptDetailResponseSchema = apiEnvelopeSchema(attemptDetailSchema);
export type AttemptDetailResponse = z.infer<typeof attemptDetailResponseSchema>;

export const attemptAnswersResponseSchema = apiEnvelopeSchema(z.object({ upserted: z.number().int() }));
export type AttemptAnswersResponse = z.infer<typeof attemptAnswersResponseSchema>;

export const attemptSubmitResponseSchema = apiEnvelopeSchema(attemptSubmitResultSchema);
export type AttemptSubmitResponse = z.infer<typeof attemptSubmitResponseSchema>;

// ---------------------------------------------------------------------------
// Result page (/practice/attempt/:attemptId/result) — score hero, topic
// breakdown, and a full per-question review.
// ---------------------------------------------------------------------------

export const attemptTopicBreakdownItemSchema = z.object({
  syllabus_node_id: z.string().uuid().nullable(),
  paper_code: z.string().nullable(),
  title_i18n: bilingualTextSchema.nullable(),
  attempted: z.number().int(),
  correct: z.number().int(),
  accuracy_pct: z.number().nullable(),
  is_weak: z.boolean(),
});
export type AttemptTopicBreakdownItem = z.infer<typeof attemptTopicBreakdownItemSchema>;

export const attemptReviewItemSchema = z.object({
  question_id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  options_i18n: z.array(questionOptionSchema).nullable(),
  chosen_option_key: z.string().nullable(),
  correct_option_key: z.string().nullable(),
  is_correct: z.boolean().nullable(),
  marks_awarded: z.number(),
  explanation_i18n: bilingualTextSchema.nullable(),
  time_spent_seconds: z.number().int().nullable(),
  syllabus_node_id: z.string().uuid().nullable(),
  paper_code: z.string().nullable(),
});
export type AttemptReviewItem = z.infer<typeof attemptReviewItemSchema>;

export const attemptResultDetailSchema = z.object({
  attempt: attemptSchema,
  test: z
    .object({
      id: z.string().uuid(),
      title_i18n: bilingualTextSchema,
      kind: testKindSchema,
      paper_code: z.string().nullable(),
    })
    .nullable(),
  score_pct: z.number().nullable(),
  percentile: z.number().nullable(),
  accuracy_pct: z.number().nullable(),
  attempted_count: z.number().int(),
  correct_count: z.number().int(),
  incorrect_count: z.number().int(),
  skipped_count: z.number().int(),
  avg_seconds_per_question: z.number().nullable(),
  avg_seconds_correct: z.number().nullable(),
  topic_breakdown: z.array(attemptTopicBreakdownItemSchema),
  review: z.array(attemptReviewItemSchema),
});
export type AttemptResultDetail = z.infer<typeof attemptResultDetailSchema>;

export const attemptResultResponseSchema = apiEnvelopeSchema(attemptResultDetailSchema);
export type AttemptResultResponse = z.infer<typeof attemptResultResponseSchema>;
