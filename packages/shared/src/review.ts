import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examStageSchema, paginatedSchema } from "./types";
import { difficultySchema, questionOptionSchema, questionSourceSchema, questionTypeSchema } from "./questions";

/** Review lifecycle for a question (migration 0035). */
export const reviewStateSchema = z.enum(["draft", "needs_review", "approved", "rejected"]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/**
 * Per-click cap on the Current Affairs "bulk approve high-confidence" action
 * — a whole-backlog approve loops one fetch+update per row server-side, so
 * it's bounded to avoid a platform request timeout on a deep backlog.
 * Shared so the UI's button label can be honest about it (a backlog bigger
 * than this needs more than one click) instead of drifting from the backend.
 */
export const CA_BULK_APPROVE_BATCH_LIMIT = 250;

/** The blind-verify outcome recorded per generated MCQ. */
export const verifyResultSchema = z.object({
  chosen_key: z.string().nullable(),
  matches_key: z.boolean(),
  confidence: z.number().nullable().optional(),
});
export type VerifyResult = z.infer<typeof verifyResultSchema>;

/** A decisive fact the critic identified and its verification status against the RAG context. */
export const decisiveFactSchema = z.object({
  fact: z.string(),
  /** grounded = supported by the retrieved passages; well_established = basic verified knowledge; unverifiable = neither. */
  status: z.enum(["grounded", "well_established", "unverifiable"]),
});
export type DecisiveFact = z.infer<typeof decisiveFactSchema>;

/** The critic (Stage B) structured verdict recorded per generated question. */
export const criticVerdictSchema = z.object({
  approve: z.boolean(),
  single_correct_answer: z.boolean(),
  options_plausible: z.boolean(),
  uppsc_tone: z.boolean(),
  out_of_syllabus: z.boolean(),
  factual_red_flags: z.array(z.string()),
  /**
   * The proper nouns / dates / numbers the answer turns on, each checked against
   * the RAG passages. Optional so pre-hardening generated rows still parse; any
   * `unverifiable` here forces approve=false ("we do not publish unverifiable trivia").
   */
  decisive_facts: z.array(decisiveFactSchema).optional(),
  /** Set when a fact-heavy candidate's decisive facts were re-checked against the web_search tool. */
  web_verified: z.boolean().optional(),
  notes: z.string(),
});
export type CriticVerdict = z.infer<typeof criticVerdictSchema>;

/**
 * questions.generation_meta — an evolving audit blob for source=generated rows
 * (null for PYQ/manual). `.passthrough()` keeps forward-compat fields; the ones
 * typed here are what the Review Queue renders.
 */
export const generationMetaSchema = z
  .object({
    model: z.string().optional(),
    prompt_version: z.string().optional(),
    difficulty: difficultySchema.optional(),
    critic: criticVerdictSchema.optional(),
    verify_result: verifyResultSchema.optional(),
    source_context_ids: z.array(z.string()).optional(),
    /** Descriptive-only: the marking-points outline the evaluator can ground on. */
    marking_points_i18n: z.object({ hi: z.array(z.string()), en: z.array(z.string()) }).optional(),
    dedup: z
      .object({
        max_similarity: z.number(),
        nearest: z.array(z.object({ question_id: z.string().uuid(), similarity: z.number() })),
      })
      .optional(),
    batch_id: z.string().uuid().optional(),
    /**
     * Set by the retroactive CA MCQ re-review sweep (scripts/ca-flag-low-quality-mcqs.ts).
     * A LIVE (is_published, approved) CA MCQ generated before the exam-worthiness
     * filter existed, flipped back to needs_review for a human's second look
     * WITHOUT unpublishing. `reason` says why it was flagged (e.g. its source
     * item had no anchored fact); present-ness alone marks it pending re-review.
     */
    re_review: z
      .object({
        reason: z.string(),
        flagged_at: z.string(),
        source_item_id: z.string().uuid().optional(),
      })
      .optional(),
  })
  .passthrough();
export type GenerationMeta = z.infer<typeof generationMetaSchema>;

/** A near-duplicate hit surfaced on the review card (resolved from meta.dedup). */
export const similarQuestionSchema = z.object({
  id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  similarity: z.number(),
  year: z.number().int().nullable(),
  source: questionSourceSchema,
});
export type SimilarQuestion = z.infer<typeof similarQuestionSchema>;

/** One card in the Review Queue. */
export const reviewQuestionSchema = z.object({
  id: z.string().uuid(),
  type: questionTypeSchema,
  stage: examStageSchema,
  paper_code: z.string(),
  syllabus_node_id: z.string().uuid().nullable(),
  syllabus_title_i18n: bilingualTextSchema.nullable(),
  year: z.number().int().nullable(),
  source: questionSourceSchema,
  stem_i18n: bilingualTextSchema,
  options_i18n: z.array(questionOptionSchema).nullable(),
  correct_option_key: z.string().nullable(),
  explanation_i18n: bilingualTextSchema.nullable(),
  difficulty: difficultySchema,
  word_limit: z.number().int().nullable(),
  marks: z.number().nullable(),
  review_state: reviewStateSchema,
  is_published: z.boolean(),
  publish_gate_ok: z.boolean(),
  generation_meta: generationMetaSchema.nullable(),
  created_at: z.string(),
  similar: z.array(similarQuestionSchema),
});
export type ReviewQuestion = z.infer<typeof reviewQuestionSchema>;

/**
 * A generated item is "high-confidence" (bulk-approvable without per-item
 * human review) when the bilingual publish gate already passes, the critic
 * raised no factual red flags, and — for an MCQ — the blind verify agreed
 * with the stored answer key. The ONE place this predicate lives, so the
 * Review Queue UI (client-side, scoped to the current page) and any
 * server-side bulk-approve action (scoped to a whole tab's backlog) can never
 * disagree about what counts as high-confidence.
 */
export function isHighConfidenceQuestion(q: {
  type: ReviewQuestion["type"];
  publish_gate_ok: boolean;
  generation_meta: GenerationMeta | null;
}): boolean {
  // A row flagged for a second human look (the retroactive CA re-review sweep)
  // is NEVER bulk-approvable — the whole point is that a human makes the call,
  // so it must not be swept back to approved by "approve all high-confidence".
  if (q.generation_meta?.re_review) return false;
  const flags = q.generation_meta?.critic?.factual_red_flags?.length ?? 0;
  return q.publish_gate_ok && flags === 0 && (q.type !== "mcq" || q.generation_meta?.verify_result?.matches_key === true);
}

/**
 * The four Review Queue tabs. `machine_translated` = content flagged
 * meta.machine_translated (PYQ Hindi regenerated from English); `current_affairs`
 * = the ca:run pool. `generated_mcq`/`generated_descriptive` = qgen output.
 */
export const reviewTabSchema = z.enum([
  "generated_mcq",
  "generated_descriptive",
  "machine_translated",
  "current_affairs",
  "notes",
  "reports",
  "question_reports",
  "magazine",
]);
export type ReviewTab = z.infer<typeof reviewTabSchema>;

export const reviewQueueQuerySchema = z.object({
  tab: reviewTabSchema.default("generated_mcq"),
  page: z.coerce.number().int().min(1).default(1),
});
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const reviewQueueResponseSchema = apiEnvelopeSchema(paginatedSchema(reviewQuestionSchema));
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;

/** Per-tab pending counts, for the tab badges. */
export const reviewCountsSchema = z.object({
  generated_mcq: z.number().int(),
  generated_descriptive: z.number().int(),
  machine_translated: z.number().int(),
  current_affairs: z.number().int(),
  notes: z.number().int(),
  reports: z.number().int(),
  question_reports: z.number().int(),
  magazine: z.number().int(),
});
export type ReviewCounts = z.infer<typeof reviewCountsSchema>;

export const reviewCountsResponseSchema = apiEnvelopeSchema(reviewCountsSchema);
export type ReviewCountsResponse = z.infer<typeof reviewCountsResponseSchema>;

/**
 * Editable fields for edit-then-approve (PATCH). All optional — only the
 * provided fields are updated. `approve: true` also transitions the row to
 * approved (publishing it iff the bilingual gate passes).
 */
export const reviewEditBodySchema = z.object({
  stem_i18n: bilingualTextSchema.optional(),
  options_i18n: z.array(questionOptionSchema).nullable().optional(),
  correct_option_key: z.string().nullable().optional(),
  explanation_i18n: bilingualTextSchema.nullable().optional(),
  difficulty: difficultySchema.optional(),
  word_limit: z.number().int().nullable().optional(),
  marks: z.number().int().nullable().optional(),
  syllabus_node_id: z.string().uuid().nullable().optional(),
  approve: z.boolean().optional(),
});
export type ReviewEditBody = z.infer<typeof reviewEditBodySchema>;

export const reviewRejectBodySchema = z.object({ reason: z.string().max(500).optional() });
export type ReviewRejectBody = z.infer<typeof reviewRejectBodySchema>;

export const reviewBulkApproveBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type ReviewBulkApproveBody = z.infer<typeof reviewBulkApproveBodySchema>;

/** Result of a single approve/reject/edit, or a bulk approve. */
export const reviewActionResultSchema = z.object({
  id: z.string().uuid().nullable(),
  review_state: reviewStateSchema,
  is_published: z.boolean(),
  /** For bulk: how many transitioned; how many were skipped (gate failed). */
  approved: z.number().int().optional(),
  published: z.number().int().optional(),
  skipped: z.number().int().optional(),
});
export type ReviewActionResult = z.infer<typeof reviewActionResultSchema>;

export const reviewActionResponseSchema = apiEnvelopeSchema(reviewActionResultSchema);
export type ReviewActionResponse = z.infer<typeof reviewActionResultSchema>;

/** GET /admin/review/current-affairs/high-confidence-count — how many CA questions in the whole needs_review backlog are currently bulk-approvable. */
export const caHighConfidenceCountSchema = z.object({ count: z.number().int() });
export type CaHighConfidenceCount = z.infer<typeof caHighConfidenceCountSchema>;

export const caHighConfidenceCountResponseSchema = apiEnvelopeSchema(caHighConfidenceCountSchema);
export type CaHighConfidenceCountResponse = z.infer<typeof caHighConfidenceCountResponseSchema>;

/** Billing mode snapshot — populated for admins only, so the active Razorpay
 * TEST/LIVE mode (and any misconfiguration) is visible in-app, not just in logs. */
export const billingModeStatusSchema = z.object({
  configured: z.boolean(),
  mode: z.enum(["test", "live"]).nullable(),
  misconfigured: z.boolean(),
  detail: z.string(),
});
export type BillingModeStatus = z.infer<typeof billingModeStatusSchema>;

/** GET /admin/status — whether the user is an admin (drives the UI gate), plus
 * the billing mode for admins (null for non-admins). */
export const adminStatusSchema = z.object({
  admin_mode: z.boolean(),
  billing: billingModeStatusSchema.nullable().optional(),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;

export const adminStatusResponseSchema = apiEnvelopeSchema(adminStatusSchema);
export type AdminStatusResponse = z.infer<typeof adminStatusResponseSchema>;
