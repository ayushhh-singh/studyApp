import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

export const attemptStartBodySchema = z
  .object({
    test_id: z.string().uuid().optional(),
    question_ids: z.array(z.string().uuid()).min(1).optional(),
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

export const attemptAnswersResponseSchema = apiEnvelopeSchema(z.object({ upserted: z.number().int() }));
export type AttemptAnswersResponse = z.infer<typeof attemptAnswersResponseSchema>;

export const attemptSubmitResponseSchema = apiEnvelopeSchema(attemptSubmitResultSchema);
export type AttemptSubmitResponse = z.infer<typeof attemptSubmitResponseSchema>;
