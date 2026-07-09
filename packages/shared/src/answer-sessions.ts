import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { testDetailSchema } from "./tests";
import { submissionStatusSchema } from "./evaluation";

export const answerSessionStatusSchema = z.enum(["in_progress", "submitted"]);
export type AnswerSessionStatus = z.infer<typeof answerSessionStatusSchema>;

export const answerSessionSchema = z.object({
  id: z.string().uuid(),
  test_id: z.string().uuid(),
  started_at: z.string(),
  duration_minutes: z.number().int().nullable(),
  submitted_at: z.string().nullable(),
  status: answerSessionStatusSchema,
});
export type AnswerSession = z.infer<typeof answerSessionSchema>;

/** Per-question submission summary within a session — null until the user submits that question. */
export const answerSessionSubmissionSchema = z.object({
  submission_id: z.string().uuid(),
  status: submissionStatusSchema,
  overall_score: z.number().nullable(),
  max_score: z.number().nullable(),
});
export type AnswerSessionSubmission = z.infer<typeof answerSessionSubmissionSchema>;

export const answerSessionDetailSchema = z.object({
  session: answerSessionSchema,
  test: testDetailSchema,
  /** question_id -> submission summary, only present once that question has been submitted. */
  submissions: z.record(z.string(), answerSessionSubmissionSchema),
});
export type AnswerSessionDetail = z.infer<typeof answerSessionDetailSchema>;

export const answerSessionResultItemSchema = z.object({
  question_id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  marks: z.number().nullable(),
  word_limit: z.number().int().nullable(),
  order_index: z.number().int(),
  submission: answerSessionSubmissionSchema.nullable(),
});
export type AnswerSessionResultItem = z.infer<typeof answerSessionResultItemSchema>;

export const answerSessionResultSchema = z.object({
  session: answerSessionSchema,
  test_title_i18n: bilingualTextSchema,
  items: z.array(answerSessionResultItemSchema),
  attempted_count: z.number().int(),
  total_count: z.number().int(),
  /** Sum of overall_score/max_score across items whose submission is 'complete'; null until at least one is. */
  total_score: z.number().nullable(),
  total_max_score: z.number().nullable(),
});
export type AnswerSessionResult = z.infer<typeof answerSessionResultSchema>;

export const startAnswerSessionBodySchema = z.object({ test_id: z.string().uuid() });
export type StartAnswerSessionBody = z.infer<typeof startAnswerSessionBodySchema>;

export const answerSessionResponseSchema = apiEnvelopeSchema(answerSessionSchema);
export type AnswerSessionResponse = z.infer<typeof answerSessionResponseSchema>;

export const answerSessionDetailResponseSchema = apiEnvelopeSchema(answerSessionDetailSchema);
export type AnswerSessionDetailResponse = z.infer<typeof answerSessionDetailResponseSchema>;

export const answerSessionResultResponseSchema = apiEnvelopeSchema(answerSessionResultSchema);
export type AnswerSessionResultResponse = z.infer<typeof answerSessionResultResponseSchema>;
