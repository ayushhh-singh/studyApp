import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, localeSchema, paginatedSchema } from "./types";

/**
 * AI Answer-Writing Evaluation — the flagship feature.
 *
 * A user submits a typed descriptive answer (to a catalogued question or a
 * custom prompt); the API runs a two-pass claude-sonnet-5 evaluation against
 * the UPPSC-style rubric below and streams the result over SSE. These schemas
 * are the shared contract between apps/api and apps/web.
 */

// ---------------------------------------------------------------------------
// Guardrail limits (shared so the body schema and the service agree).
// ---------------------------------------------------------------------------
/** Max characters of answer text accepted for a single evaluation. */
export const MAX_ANSWER_CHARS = 20_000;
/** Max characters of a custom (non-catalogued) question prompt. */
export const MAX_CUSTOM_QUESTION_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Rubric (v1)
// ---------------------------------------------------------------------------
export const RUBRIC_VERSION = "v1";

export const rubricDimensionKeySchema = z.enum([
  "structure_flow",
  "content_coverage",
  "keywords_concepts",
  "examples_data",
  "presentation",
  "word_limit_language",
]);
export type RubricDimensionKey = z.infer<typeof rubricDimensionKeySchema>;

/** The six rubric dimension keys in canonical display order. */
export const RUBRIC_DIMENSION_KEYS = rubricDimensionKeySchema.options;

/** One rubric dimension's result: 0-10 score + weight + short justification. */
export const dimensionScoreSchema = z.object({
  key: rubricDimensionKeySchema,
  label: z.string(),
  /** Fraction of the overall weighting, 0..1 (all dimensions sum to 1). */
  weight: z.number(),
  /** 0-10, integer in practice. */
  score: z.number().min(0).max(10),
  justification: z.string(),
});
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const factualErrorSchema = z.object({
  /** The candidate's own words that are wrong (may be empty if diffuse). */
  quote: z.string(),
  issue: z.string(),
});
export type FactualError = z.infer<typeof factualErrorSchema>;

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------
export const submissionModeSchema = z.enum(["typed", "handwritten"]);
export type SubmissionMode = z.infer<typeof submissionModeSchema>;

export const submissionStatusSchema = z.enum([
  "pending",
  "ocr_processing",
  "ocr_done",
  "evaluating",
  "complete",
  "failed",
]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** Max handwritten page photos accepted for a single submission. */
export const MAX_ANSWER_IMAGES = 6;

/**
 * POST /answers/submissions body. Exactly one of `question_id` (catalogued) or
 * `custom_question_text` (a prompt the user typed in themselves) must be set.
 * `word_limit`/`marks` are optional overrides for the custom path; for a
 * catalogued question they come from the questions row.
 *
 * `mode: "typed"` requires `typed_text`. `mode: "handwritten"` requires
 * `image_paths` (1-6 paths already uploaded by the client straight to the
 * `answer-images` Supabase Storage bucket) — `typed_text` is filled in later,
 * once the user confirms the OCR transcription (see PATCH
 * /answers/submissions/:id/confirm-ocr).
 */
export const createSubmissionBodySchema = z
  .object({
    question_id: z.string().uuid().optional(),
    custom_question_text: z.string().trim().min(1).max(MAX_CUSTOM_QUESTION_CHARS).optional(),
    mode: submissionModeSchema.default("typed"),
    typed_text: z.string().min(1).max(MAX_ANSWER_CHARS).optional(),
    image_paths: z.array(z.string().min(1)).min(1).max(MAX_ANSWER_IMAGES).optional(),
    language: localeSchema,
    word_limit: z.number().int().positive().max(2_000).optional(),
    marks: z.number().int().positive().max(100).optional(),
  })
  .refine((b) => (b.question_id ? 1 : 0) + (b.custom_question_text ? 1 : 0) === 1, {
    message: "Provide exactly one of question_id or custom_question_text",
  })
  .refine((b) => (b.mode === "typed" ? !!b.typed_text?.trim() : true), {
    message: "typed_text: answer text is required",
  })
  .refine((b) => (b.mode === "handwritten" ? !!b.image_paths?.length : true), {
    message: "image_paths: at least one page image is required for a handwritten submission",
  })
  .refine((b) => (b.mode === "typed" ? !b.image_paths?.length : true), {
    message: "image_paths must not be supplied for a typed submission",
  })
  .refine((b) => (b.mode === "handwritten" ? !b.typed_text : true), {
    message: "typed_text must not be supplied for a handwritten submission (confirm the OCR transcription instead)",
  });
export type CreateSubmissionBody = z.infer<typeof createSubmissionBodySchema>;

/** PATCH /answers/submissions/:id/confirm-ocr — the user's reviewed/edited transcription. */
export const confirmOcrBodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
});
export type ConfirmOcrBody = z.infer<typeof confirmOcrBodySchema>;

export const submissionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  question_id: z.string().uuid().nullable(),
  custom_question_text_i18n: bilingualTextSchema.nullable(),
  mode: submissionModeSchema,
  typed_text: z.string().nullable(),
  image_paths: z.array(z.string()).nullable(),
  ocr_text: z.string().nullable(),
  ocr_confidence: z.number().nullable(),
  status: submissionStatusSchema,
  language: localeSchema,
  created_at: z.string(),
});
export type Submission = z.infer<typeof submissionSchema>;

export const submissionResponseSchema = apiEnvelopeSchema(submissionSchema);
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;

// ---------------------------------------------------------------------------
// Evaluation (persisted result)
// ---------------------------------------------------------------------------
/** The analysis surfaced from pass 1 (also stored inside raw_response). */
export const evaluationAnalysisSchema = z.object({
  is_off_topic: z.boolean(),
  reference_points: z.array(z.string()),
  missed_key_points: z.array(z.string()),
  factual_errors: z.array(factualErrorSchema),
  overall_comment: z.string(),
});
export type EvaluationAnalysis = z.infer<typeof evaluationAnalysisSchema>;

export const evaluationSchema = z.object({
  id: z.string().uuid(),
  submission_id: z.string().uuid(),
  model: z.string(),
  rubric_version: z.string(),
  overall_score: z.number().nullable(),
  max_score: z.number().nullable(),
  dimension_scores: z.array(dimensionScoreSchema).nullable(),
  strengths_i18n: bilingualTextSchema.nullable(),
  improvements_i18n: bilingualTextSchema.nullable(),
  model_answer_i18n: bilingualTextSchema.nullable(),
  analysis: evaluationAnalysisSchema.nullable(),
  tokens_used: z.number().nullable(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

/** GET /answers/submissions/:id — the submission plus its evaluation (if any). */
export const submissionDetailSchema = z.object({
  submission: submissionSchema,
  evaluation: evaluationSchema.nullable(),
});
export type SubmissionDetail = z.infer<typeof submissionDetailSchema>;

export const submissionDetailResponseSchema = apiEnvelopeSchema(submissionDetailSchema);
export type SubmissionDetailResponse = z.infer<typeof submissionDetailResponseSchema>;

// ---------------------------------------------------------------------------
// SSE event payloads (server -> client). Documented here so the web client and
// the eval harness share one wire contract.
// ---------------------------------------------------------------------------
export const evalStatusPhaseSchema = z.enum([
  "grounding",
  "analyzing",
  "scoring",
  "feedback",
  "model_answer",
  "persisting",
]);
export type EvalStatusPhase = z.infer<typeof evalStatusPhaseSchema>;

export const evalStatusEventSchema = z.object({
  phase: evalStatusPhaseSchema,
  message: z.string().optional(),
});
export type EvalStatusEvent = z.infer<typeof evalStatusEventSchema>;

/** One `dimension_score` event: a DimensionScore plus the fixed max of 10. */
export const dimensionScoreEventSchema = dimensionScoreSchema.extend({ max: z.literal(10) });
export type DimensionScoreEvent = z.infer<typeof dimensionScoreEventSchema>;

export const analysisEventSchema = evaluationAnalysisSchema.extend({
  overall_score: z.number(),
  max_score: z.number(),
});
export type AnalysisEvent = z.infer<typeof analysisEventSchema>;

export const feedbackSectionSchema = z.enum(["strengths", "improvements"]);
export type FeedbackSection = z.infer<typeof feedbackSectionSchema>;

export const feedbackDeltaEventSchema = z.object({
  section: feedbackSectionSchema,
  text: z.string(),
});
export type FeedbackDeltaEvent = z.infer<typeof feedbackDeltaEventSchema>;

export const modelAnswerDeltaEventSchema = z.object({ text: z.string() });
export type ModelAnswerDeltaEvent = z.infer<typeof modelAnswerDeltaEventSchema>;

export const evalDoneEventSchema = z.object({
  evaluation_id: z.string().uuid(),
  overall_score: z.number(),
  max_score: z.number(),
});
export type EvalDoneEvent = z.infer<typeof evalDoneEventSchema>;

export const evalErrorEventSchema = z.object({ message: z.string() });
export type EvalErrorEvent = z.infer<typeof evalErrorEventSchema>;

// ---------------------------------------------------------------------------
// OCR SSE event payloads — GET /stream/ocr/:submissionId (handwritten mode).
// Event order: delta ×N (live transcription text) -> done. A submission that
// already has ocr_text replays it as a single "done" with no delta events, the
// same idempotent-replay contract as the evaluation stream.
// ---------------------------------------------------------------------------
export const ocrDeltaEventSchema = z.object({ text: z.string() });
export type OcrDeltaEvent = z.infer<typeof ocrDeltaEventSchema>;

export const ocrDoneEventSchema = z.object({
  ocr_text: z.string(),
  ocr_confidence: z.number(),
});
export type OcrDoneEvent = z.infer<typeof ocrDoneEventSchema>;

export const ocrErrorEventSchema = z.object({ message: z.string() });
export type OcrErrorEvent = z.infer<typeof ocrErrorEventSchema>;

// ---------------------------------------------------------------------------
// Submission history (GET /answers/submissions) — one row per past submission,
// with just enough of its evaluation (if any) to render a score/status chip
// without a second round-trip per row.
// ---------------------------------------------------------------------------
export const submissionListItemSchema = z.object({
  id: z.string().uuid(),
  status: submissionStatusSchema,
  mode: submissionModeSchema,
  language: localeSchema,
  created_at: z.string(),
  question_id: z.string().uuid().nullable(),
  question_stem_i18n: bilingualTextSchema.nullable(),
  overall_score: z.number().nullable(),
  max_score: z.number().nullable(),
});
export type SubmissionListItem = z.infer<typeof submissionListItemSchema>;

export const submissionListResponseSchema = apiEnvelopeSchema(paginatedSchema(submissionListItemSchema));
export type SubmissionListResponse = z.infer<typeof submissionListResponseSchema>;
