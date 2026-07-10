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
// Teacher mode — depth toggle (Quick / Standard / In-depth). Standard is the
// default. In-depth is the heaviest tier (larger token budget + web research)
// and so costs 2 messages against the daily mentor quota — surfaced in the UI
// BEFORE sending. The cost lives here so the client's "uses N messages" hint
// and the server's enforcement can never disagree.
// ---------------------------------------------------------------------------
export const mentorDepthSchema = z.enum(["quick", "standard", "in_depth"]);
export type MentorDepth = z.infer<typeof mentorDepthSchema>;

/** Quota cost of one message: only an in-depth TEACHER response costs 2. */
export function mentorQuotaCost(opts: { teach: boolean; depth: MentorDepth }): number {
  return opts.teach && opts.depth === "in_depth" ? 2 : 1;
}

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

// ---------------------------------------------------------------------------
// Teacher-mode structured extras (rendered as UI, not prose). The prose (Concept
// / Explanation / Exam relevance) streams as markdown into `content`; these come
// from OUR bank + the qgen service and are attached to the message meta.
// ---------------------------------------------------------------------------
/** A real PYQ from our bank, surfaced under a teacher answer (tappable to practice). */
export const mentorPyqRefSchema = z.object({
  id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  paper_code: z.string(),
  syllabus_node_id: z.string().nullable(),
  year: z.number().int().nullable(),
  exam_label_i18n: bilingualTextSchema.nullable(),
  type: z.string(),
});
export type MentorPyqRef = z.infer<typeof mentorPyqRefSchema>;

/** An adjacent syllabus node suggested as "continue with". */
export const mentorContinueNodeSchema = z.object({
  node_id: z.string().uuid(),
  paper_code: z.string(),
  title_i18n: bilingualTextSchema,
});
export type MentorContinueNode = z.infer<typeof mentorContinueNodeSchema>;

/** A web source cited by an in-depth teacher answer as [Sn]. */
export const mentorWebSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});
export type MentorWebSource = z.infer<typeof mentorWebSourceSchema>;

/** doubt_messages.meta payloads. Empty {} for a plain answer. */
export const mentorMessageMetaSchema = z
  .object({
    /** 'quiz' → the in-thread quiz-me cards; 'teacher' → a structured lesson. */
    kind: z.enum(["quiz", "teacher"]).optional(),
    /** quiz-me: 3 ephemeral MCQs. */
    questions: z.array(mentorQuizQuestionSchema).optional(),
    // --- teacher-mode extras ---
    depth: mentorDepthSchema.optional(),
    /** The syllabus node the lesson resolved to (for related PYQs + save-as-material inference). */
    node_id: z.string().nullable().optional(),
    /** 2 ephemeral quick-check MCQs, answerable inline (never persisted to the bank). */
    quick_check: z.array(mentorQuizQuestionSchema).optional(),
    /** Real PYQs from our bank for this node. */
    related_pyqs: z.array(mentorPyqRefSchema).optional(),
    /** 2-3 adjacent syllabus nodes. */
    continue_with: z.array(mentorContinueNodeSchema).optional(),
    /** External sources cited by an in-depth answer. */
    web_sources: z.array(mentorWebSourceSchema).optional(),
    /** Compressed 5-bullet "explain like revision" mode. */
    revision: z.boolean().optional(),
    /** Served from the FAQ semantic cache (no model call). */
    from_cache: z.boolean().optional(),
    /** A "from a similar doubt" (0.86–0.95) cache reply — shows the notice. */
    similar: z.boolean().optional(),
    /** Revision recap compressed from a cached full answer (one haiku call). */
    compressed: z.boolean().optional(),
    /** Regenerated via "Answer fresh" (cache bypassed; updates the cached entry). */
    regenerated: z.boolean().optional(),
    /** On a user turn: how many messages this consumed against the quota. */
    quota_cost: z.number().int().optional(),
    /** On a user turn: whether the student explicitly asked to be taught. */
    teach: z.boolean().optional(),
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
  /** 'revision' → compressed 5-bullet answer (quick-doubt path only). */
  mode: z.enum(["normal", "revision"]).default("normal"),
  /**
   * Force teacher mode (the "Teach me this" entry points). When false, the
   * server auto-detects a teach intent from the message.
   */
  teach: z.boolean().default(false),
  /** Depth of a teacher response (ignored by the quick-doubt path). */
  depth: mentorDepthSchema.default("standard"),
  /** Optional syllabus node to scope retrieval (page context / seed). */
  node_id: z.string().uuid().optional(),
  /**
   * Skip the FAQ semantic cache and force a fresh model answer (the "Answer
   * fresh" action on a "from a similar doubt" reply). The regenerated answer
   * still UPDATES the cached entry, so newest wins.
   */
  bypass_cache: z.boolean().default(false),
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
  phase: z.enum(["retrieving", "researching", "thinking", "answering", "wrapping_up"]),
});
export type DoubtStatusEvent = z.infer<typeof doubtStatusEventSchema>;

export const doubtCitationsEventSchema = z.object({
  citations: z.array(mentorCitationSchema),
  /** true when retrieval was too weak to ground the answer in platform content. */
  weak: z.boolean(),
});
export type DoubtCitationsEvent = z.infer<typeof doubtCitationsEventSchema>;

export const doubtSourceEventSchema = z.object({
  from_cache: z.boolean(),
  /** true only for a 0.86–0.95 "similar doubt" reply — drives the notice + "Answer fresh". */
  similar: z.boolean().optional(),
});
export type DoubtSourceEvent = z.infer<typeof doubtSourceEventSchema>;

export const doubtDeltaEventSchema = z.object({ text: z.string() });
export type DoubtDeltaEvent = z.infer<typeof doubtDeltaEventSchema>;

export const doubtDoneEventSchema = z.object({
  message_id: z.string().uuid(),
  thread_id: z.string().uuid(),
});
export type DoubtDoneEvent = z.infer<typeof doubtDoneEventSchema>;

// Teacher-mode extra events — emitted AFTER the prose stream, before `done`.
// Event order (teacher): status(retrieving) -> [status(researching)] ->
// citations -> [web_sources] -> status(teaching) -> delta ×N ->
// status(wrapping_up) -> related_pyqs -> quick_check -> continue_with -> done.
export const doubtTeacherEventSchema = z.object({
  depth: mentorDepthSchema,
  node_id: z.string().nullable(),
});
export type DoubtTeacherEvent = z.infer<typeof doubtTeacherEventSchema>;

export const doubtWebSourcesEventSchema = z.object({
  web_sources: z.array(mentorWebSourceSchema),
});
export type DoubtWebSourcesEvent = z.infer<typeof doubtWebSourcesEventSchema>;

export const doubtRelatedPyqsEventSchema = z.object({
  pyqs: z.array(mentorPyqRefSchema),
});
export type DoubtRelatedPyqsEvent = z.infer<typeof doubtRelatedPyqsEventSchema>;

export const doubtQuickCheckEventSchema = z.object({
  questions: z.array(mentorQuizQuestionSchema),
});
export type DoubtQuickCheckEvent = z.infer<typeof doubtQuickCheckEventSchema>;

export const doubtContinueWithEventSchema = z.object({
  nodes: z.array(mentorContinueNodeSchema),
});
export type DoubtContinueWithEvent = z.infer<typeof doubtContinueWithEventSchema>;

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
