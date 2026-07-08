import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, localeSchema } from "./types";

/**
 * The AI Mentor — a RAG doubt-solving chatbot grounded in OUR platform content
 * AND the learner's own data, plus proactive (never-initiating) nudge cards.
 * These schemas are the shared contract between apps/api and apps/web, including
 * the SSE wire format for the streamed doubt answer.
 */

// ---------------------------------------------------------------------------
// Limits (shared so the body schema and the service/rate-limit agree).
// ---------------------------------------------------------------------------
/** Max characters of a single doubt message. */
export const MAX_DOUBT_CHARS = 4_000;
/** Per-user daily message cap (API-enforced; plan-aware in a later session). */
export const DOUBT_DAILY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Citations — inline numbered refs mapped to retrieved chunks.
// ---------------------------------------------------------------------------
export const mentorCitationSchema = z.object({
  /** 1-based number the answer cites inline as [ref]. */
  ref: z.number().int(),
  /** syllabus | question | note | current_affairs (chunk source). */
  source_type: z.string(),
  source_id: z.string(),
  title_i18n: bilingualTextSchema,
  /** In-app deep link (locale prefixed client-side); null when un-linkable. */
  link: z.string().nullable(),
});
export type MentorCitation = z.infer<typeof mentorCitationSchema>;

// ---------------------------------------------------------------------------
// In-thread quiz cards ("quiz me on this" — Feature 4). Ephemeral: rendered as
// answerable cards, never persisted to the questions bank.
// ---------------------------------------------------------------------------
export const mentorQuizOptionSchema = z.object({
  key: z.string(),
  text_i18n: bilingualTextSchema,
});
export const mentorQuizQuestionSchema = z.object({
  stem_i18n: bilingualTextSchema,
  options: z.array(mentorQuizOptionSchema),
  correct_option_key: z.string(),
  explanation_i18n: bilingualTextSchema,
});
export type MentorQuizQuestion = z.infer<typeof mentorQuizQuestionSchema>;

/** doubt_messages.meta payloads. Empty {} for a plain answer. */
export const mentorMessageMetaSchema = z
  .object({
    kind: z.literal("quiz").optional(),
    questions: z.array(mentorQuizQuestionSchema).optional(),
    /** Compressed 5-bullet "explain like revision" mode. */
    revision: z.boolean().optional(),
    /** Served from the FAQ semantic cache (no model call). */
    from_cache: z.boolean().optional(),
  })
  .default({});
export type MentorMessageMeta = z.infer<typeof mentorMessageMetaSchema>;

// ---------------------------------------------------------------------------
// Threads + messages
// ---------------------------------------------------------------------------
export const doubtRoleSchema = z.enum(["user", "assistant"]);
export type DoubtRole = z.infer<typeof doubtRoleSchema>;

export const doubtMessageSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  role: doubtRoleSchema,
  content: z.string(),
  citations: z.array(mentorCitationSchema),
  used_profile: z.boolean(),
  meta: mentorMessageMetaSchema,
  created_at: z.string(),
});
export type DoubtMessage = z.infer<typeof doubtMessageSchema>;

export const doubtThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DoubtThread = z.infer<typeof doubtThreadSchema>;

/** One row in the thread list — thread + a cheap preview, no full messages. */
export const doubtThreadSummarySchema = doubtThreadSchema.extend({
  message_count: z.number().int(),
  last_message_preview: z.string().nullable(),
});
export type DoubtThreadSummary = z.infer<typeof doubtThreadSummarySchema>;

export const doubtThreadDetailSchema = z.object({
  thread: doubtThreadSchema,
  messages: z.array(doubtMessageSchema),
});
export type DoubtThreadDetail = z.infer<typeof doubtThreadDetailSchema>;

// Request bodies
export const createThreadBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateThreadBody = z.infer<typeof createThreadBodySchema>;

/** SSE POST body — the user's new message. */
export const doubtMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(MAX_DOUBT_CHARS),
  /** 'revision' → compressed 5-bullet answer. */
  mode: z.enum(["normal", "revision"]).default("normal"),
  /** Optional syllabus node to scope retrieval (page context / seed). */
  node_id: z.string().uuid().optional(),
});
export type DoubtMessageBody = z.infer<typeof doubtMessageBodySchema>;

// Response envelopes
export const doubtThreadResponseSchema = apiEnvelopeSchema(doubtThreadSchema);
export const doubtThreadListResponseSchema = apiEnvelopeSchema(
  z.object({ items: z.array(doubtThreadSummarySchema) }),
);
export const doubtThreadDetailResponseSchema = apiEnvelopeSchema(doubtThreadDetailSchema);
export const doubtMessageResponseSchema = apiEnvelopeSchema(doubtMessageSchema);

// ---------------------------------------------------------------------------
// SSE wire contract — POST /stream/doubts/:threadId/messages
// Event order: status -> citations -> source -> delta ×N -> done. A FAQ-cache
// hit arrives as source{from_cache:true} then a single delta with the full
// stored answer, then done — the same accumulate-into-a-string reducer works
// for both a live model stream and a cache replay.
// ---------------------------------------------------------------------------
export const doubtStatusEventSchema = z.object({
  phase: z.enum(["retrieving", "thinking", "answering"]),
});
export type DoubtStatusEvent = z.infer<typeof doubtStatusEventSchema>;

export const doubtCitationsEventSchema = z.object({
  citations: z.array(mentorCitationSchema),
  /** true when retrieval was too weak to ground the answer in platform content. */
  weak: z.boolean(),
});
export type DoubtCitationsEvent = z.infer<typeof doubtCitationsEventSchema>;

export const doubtSourceEventSchema = z.object({ from_cache: z.boolean() });
export type DoubtSourceEvent = z.infer<typeof doubtSourceEventSchema>;

export const doubtDeltaEventSchema = z.object({ text: z.string() });
export type DoubtDeltaEvent = z.infer<typeof doubtDeltaEventSchema>;

export const doubtDoneEventSchema = z.object({
  message_id: z.string().uuid(),
  thread_id: z.string().uuid(),
});
export type DoubtDoneEvent = z.infer<typeof doubtDoneEventSchema>;

export const doubtErrorEventSchema = z.object({ message: z.string() });
export type DoubtErrorEvent = z.infer<typeof doubtErrorEventSchema>;

// ---------------------------------------------------------------------------
// Proactive mentor insights (Feature 5) — dashboard nudge cards.
// ---------------------------------------------------------------------------
export const mentorInsightSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  insight_i18n: bilingualTextSchema,
  cta_link: z.string().nullable(),
  created_at: z.string(),
});
export type MentorInsight = z.infer<typeof mentorInsightSchema>;

export const mentorInsightsResponseSchema = apiEnvelopeSchema(
  z.object({ insights: z.array(mentorInsightSchema) }),
);
export const mentorInsightResponseSchema = apiEnvelopeSchema(mentorInsightSchema);

// ---------------------------------------------------------------------------
// Learner profile (Feature 1) — compact, size-capped. Mostly server-internal,
// exposed by the on-demand refresh endpoint for transparency/debugging.
// ---------------------------------------------------------------------------
export const learnerProfileNodeSchema = z.object({
  node_id: z.string(),
  paper_code: z.string(),
  title_i18n: bilingualTextSchema,
  accuracy_pct: z.number(),
  answered_count: z.number().int(),
});

export const learnerProfileSchema = z.object({
  weak_nodes: z.array(learnerProfileNodeSchema),
  strong_nodes: z.array(learnerProfileNodeSchema),
  evaluation: z.object({
    count: z.number().int(),
    recent_overall_pct: z.number().nullable(),
    trend: z.enum(["up", "down", "flat", "none"]),
    dimension_avgs: z.record(z.string(), z.number()),
    weakest_dimension: z.string().nullable(),
  }),
  streak_count: z.number().int(),
  days_to_exam: z.number().int().nullable(),
  recent_nodes: z.array(
    z.object({ node_id: z.string(), paper_code: z.string(), title_i18n: bilingualTextSchema }),
  ),
  activity_last_7d: z.object({
    answers_written: z.number().int(),
    mcqs_attempted: z.number().int(),
    srs_reviews: z.number().int(),
  }),
  locale: localeSchema,
  computed_at: z.string(),
});
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

export const learnerProfileResponseSchema = apiEnvelopeSchema(learnerProfileSchema);
