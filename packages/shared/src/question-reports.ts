import { z } from "zod";
import { apiEnvelopeSchema, paginatedSchema } from "./types";
import { generationMetaSchema, reviewQuestionSchema, reviewStateSchema } from "./review";

/**
 * Why a question is flagged (migration 0071). The first five are user-selectable
 * "Report this question" reasons; `ai_key_dispute` is a SYSTEM-generated flag
 * (user_id=null) raised when the blind re-solve disagrees with an official key
 * (migration 0074) — it lands in the same admin Review Queue but is never offered
 * to users in the report form.
 */
export const questionReportReasonSchema = z.enum([
  "wrong_answer",
  "wrong_explanation",
  "translation",
  "ambiguous",
  "other",
  "ai_key_dispute",
]);
export type QuestionReportReason = z.infer<typeof questionReportReasonSchema>;

export const questionReportStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export type QuestionReportStatus = z.infer<typeof questionReportStatusSchema>;

// ---------------------------------------------------------------------------
// User-facing submit
// ---------------------------------------------------------------------------
export const createQuestionReportBodySchema = z.object({
  reason: questionReportReasonSchema,
  detail: z.string().max(1000).optional(),
});
export type CreateQuestionReportBody = z.infer<typeof createQuestionReportBodySchema>;

export const questionReportResultSchema = z.object({
  id: z.string().uuid(),
  status: questionReportStatusSchema,
  /** True when this report was the second independent one → question auto-hidden pending review. */
  auto_hidden: z.boolean(),
});
export type QuestionReportResult = z.infer<typeof questionReportResultSchema>;
export const questionReportResultResponseSchema = apiEnvelopeSchema(questionReportResultSchema);

// ---------------------------------------------------------------------------
// Admin Reports queue (the Review Queue's "Reported questions" tab)
// ---------------------------------------------------------------------------
/** Provenance shown on the admin card so a reviewer can judge the source. */
export const questionReportProvenanceSchema = z.object({
  source_kind: z.string().nullable(),
  exam_code: z.string().nullable(),
  year: z.number().int().nullable(),
  prompt_version: z.string().nullable(),
  is_published: z.boolean(),
  review_state: reviewStateSchema,
  answer_key_verified: z.boolean(),
  generation_meta: generationMetaSchema.nullable(),
});
export type QuestionReportProvenance = z.infer<typeof questionReportProvenanceSchema>;

export const questionReportEntrySchema = z.object({
  reason: questionReportReasonSchema,
  detail: z.string().nullable(),
  created_at: z.string(),
});
export type QuestionReportEntry = z.infer<typeof questionReportEntrySchema>;

export const questionReportQueueItemSchema = z.object({
  question_id: z.string().uuid(),
  report_count: z.number().int(),
  reasons: z.array(questionReportReasonSchema),
  reports: z.array(questionReportEntrySchema),
  latest_created_at: z.string(),
  /** Reuses the Review Queue card shape so the admin panel renders the full question. */
  question: reviewQuestionSchema,
  provenance: questionReportProvenanceSchema,
});
export type QuestionReportQueueItem = z.infer<typeof questionReportQueueItemSchema>;

export const questionReportsQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
export const questionReportsQueueResponseSchema = apiEnvelopeSchema(paginatedSchema(questionReportQueueItemSchema));
export type QuestionReportsQueueResponse = z.infer<typeof questionReportsQueueResponseSchema>;

/** Admin resolution actions. */
export const questionReportActionSchema = z.enum([
  "fix_key",
  "regenerate_explanation",
  "unpublish",
  "dismiss",
]);
export type QuestionReportAction = z.infer<typeof questionReportActionSchema>;

export const resolveQuestionReportBodySchema = z
  .object({
    action: questionReportActionSchema,
    /** Required for fix_key — the corrected option key. */
    correct_option_key: z.enum(["A", "B", "C", "D"]).optional(),
  })
  .refine((v) => v.action !== "fix_key" || !!v.correct_option_key, {
    message: "correct_option_key is required for fix_key",
    path: ["correct_option_key"],
  });
export type ResolveQuestionReportBody = z.infer<typeof resolveQuestionReportBodySchema>;

export const questionReportActionResultSchema = z.object({
  question_id: z.string().uuid(),
  action: questionReportActionSchema,
  is_published: z.boolean(),
  review_state: reviewStateSchema,
  resolved_reports: z.number().int(),
});
export type QuestionReportActionResult = z.infer<typeof questionReportActionResultSchema>;
export const questionReportActionResponseSchema = apiEnvelopeSchema(questionReportActionResultSchema);
