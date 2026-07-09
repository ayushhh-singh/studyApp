import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";
import { dimensionScoreSchema } from "./evaluation";

/**
 * COMMUNITY v1 — discussion threads attached to content (questions, syllabus
 * nodes, current-affairs items, shared answers) and peer review of shared
 * answers. Public identity is the `handle`/`display_name` chosen at
 * onboarding — real emails never render here (see communityAuthorSchema).
 */

export const discussionAnchorTypeSchema = z.enum(["question", "node", "ca_item", "shared_answer"]);
export type DiscussionAnchorType = z.infer<typeof discussionAnchorTypeSchema>;

export const moderationStatusSchema = z.enum(["visible", "flagged", "removed"]);
export type ModerationStatus = z.infer<typeof moderationStatusSchema>;

export const reportTargetTypeSchema = z.enum(["thread", "post"]);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const reportReasonSchema = z.enum(["spam", "abuse", "harassment", "off_topic", "pii", "other"]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const reportStatusSchema = z.enum(["open", "actioned", "dismissed"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

/** Public-safe author identity — never the user's email or other profile fields. */
export const communityAuthorSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().nullable(),
  display_name: z.string().nullable(),
});
export type CommunityAuthor = z.infer<typeof communityAuthorSchema>;

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export const discussionThreadSchema = z.object({
  id: z.string().uuid(),
  anchor_type: discussionAnchorTypeSchema,
  anchor_id: z.string().uuid(),
  title: z.string(),
  author: communityAuthorSchema,
  is_locked: z.boolean(),
  moderation_status: moderationStatusSchema,
  post_count: z.number().int(),
  /**
   * Resolved display label for `anchor_type === 'node'` threads only — the
   * anchored syllabus node's own bilingual title + paper code, batch-looked-up
   * server-side so the hub/thread views can show what topic a thread is
   * about without a click-through. Null for every other anchor type, and
   * null (not an error) if the anchor node was since deleted.
   */
  anchor_node_title_i18n: bilingualTextSchema.nullable(),
  anchor_node_paper_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DiscussionThread = z.infer<typeof discussionThreadSchema>;

export const createDiscussionThreadBodySchema = z.object({
  anchor_type: discussionAnchorTypeSchema,
  anchor_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  body: z.string().min(1).max(5000),
});
export type CreateDiscussionThreadBody = z.infer<typeof createDiscussionThreadBodySchema>;

export const communityThreadsQuerySchema = z.object({
  anchor_type: discussionAnchorTypeSchema,
  anchor_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
});
export type CommunityThreadsQuery = z.infer<typeof communityThreadsQuerySchema>;

export const discussionThreadResponseSchema = apiEnvelopeSchema(discussionThreadSchema);
export type DiscussionThreadResponse = z.infer<typeof discussionThreadResponseSchema>;

export const listDiscussionThreadsResponseSchema = apiEnvelopeSchema(paginatedSchema(discussionThreadSchema));
export type ListDiscussionThreadsResponse = z.infer<typeof listDiscussionThreadsResponseSchema>;

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
export const discussionPostSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  author: communityAuthorSchema,
  body: z.string(),
  is_deleted: z.boolean(),
  moderation_status: moderationStatusSchema,
  vote_score: z.number().int(),
  /** The CALLING user's own vote on this post: -1, 0 (none), or 1. */
  my_vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  edited_at: z.string().nullable(),
  created_at: z.string(),
});
export type DiscussionPost = z.infer<typeof discussionPostSchema>;

export const createDiscussionPostBodySchema = z.object({ body: z.string().min(1).max(5000) });
export type CreateDiscussionPostBody = z.infer<typeof createDiscussionPostBodySchema>;

export const updateDiscussionPostBodySchema = z.object({ body: z.string().min(1).max(5000) });
export type UpdateDiscussionPostBody = z.infer<typeof updateDiscussionPostBodySchema>;

export const discussionPostResponseSchema = apiEnvelopeSchema(discussionPostSchema);
export type DiscussionPostResponse = z.infer<typeof discussionPostResponseSchema>;

/** GET /community/threads/:id — the thread plus its (paginated) posts. */
export const discussionThreadDetailSchema = z.object({
  thread: discussionThreadSchema,
  posts: z.array(discussionPostSchema),
  pagination: z.object({
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
  }),
});
export type DiscussionThreadDetail = z.infer<typeof discussionThreadDetailSchema>;
export const discussionThreadDetailResponseSchema = apiEnvelopeSchema(discussionThreadDetailSchema);
export type DiscussionThreadDetailResponse = z.infer<typeof discussionThreadDetailResponseSchema>;

export const postsQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
export type PostsQuery = z.infer<typeof postsQuerySchema>;

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------
export const votePostBodySchema = z.object({ value: z.union([z.literal(-1), z.literal(1)]) });
export type VotePostBody = z.infer<typeof votePostBodySchema>;

export const voteResultSchema = z.object({
  vote_score: z.number().int(),
  my_vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});
export type VoteResult = z.infer<typeof voteResultSchema>;
export const voteResultResponseSchema = apiEnvelopeSchema(voteResultSchema);
export type VoteResultResponse = z.infer<typeof voteResultResponseSchema>;

// ---------------------------------------------------------------------------
// Shared answers — peer review
// ---------------------------------------------------------------------------
export const shareAnswerBodySchema = z.object({ submission_id: z.string().uuid() });
export type ShareAnswerBody = z.infer<typeof shareAnswerBodySchema>;

export const sharedAnswerSchema = z.object({
  id: z.string().uuid(),
  submission_id: z.string().uuid(),
  author: communityAuthorSchema,
  thread_id: z.string().uuid(),
  question_text_i18n: bilingualTextSchema,
  answer_text: z.string().nullable(),
  image_paths: z.array(z.string()).nullable(),
  overall_score: z.number().nullable(),
  max_score: z.number().nullable(),
  dimension_scores: z.array(dimensionScoreSchema).nullable(),
  /** Total "mark helpful" votes (value=1) cast on any reply in this thread. */
  helpful_count: z.number().int(),
  post_count: z.number().int(),
  created_at: z.string(),
});
export type SharedAnswer = z.infer<typeof sharedAnswerSchema>;

export const sharedAnswerResponseSchema = apiEnvelopeSchema(sharedAnswerSchema);
export type SharedAnswerResponse = z.infer<typeof sharedAnswerResponseSchema>;

export const listSharedAnswersResponseSchema = apiEnvelopeSchema(paginatedSchema(sharedAnswerSchema));
export type ListSharedAnswersResponse = z.infer<typeof listSharedAnswersResponseSchema>;

export const sharedAnswersQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
export type SharedAnswersQuery = z.infer<typeof sharedAnswersQuerySchema>;

// ---------------------------------------------------------------------------
// Community hub
// ---------------------------------------------------------------------------
export const communityHubSchema = z.object({
  recent_threads: z.array(discussionThreadSchema),
  open_peer_review: z.array(sharedAnswerSchema),
  my_threads: z.array(discussionThreadSchema),
});
export type CommunityHub = z.infer<typeof communityHubSchema>;
export const communityHubResponseSchema = apiEnvelopeSchema(communityHubSchema);
export type CommunityHubResponse = z.infer<typeof communityHubResponseSchema>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const reportContentBodySchema = z.object({
  target_type: reportTargetTypeSchema,
  target_id: z.string().uuid(),
  reason: reportReasonSchema,
  detail: z.string().max(500).optional(),
});
export type ReportContentBody = z.infer<typeof reportContentBodySchema>;

export const reportResultSchema = z.object({ id: z.string().uuid(), status: reportStatusSchema });
export type ReportResult = z.infer<typeof reportResultSchema>;
export const reportResultResponseSchema = apiEnvelopeSchema(reportResultSchema);
export type ReportResultResponse = z.infer<typeof reportResultResponseSchema>;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
export const blockUserBodySchema = z.object({ blocked_user_id: z.string().uuid() });
export type BlockUserBody = z.infer<typeof blockUserBodySchema>;

export const blockedUserSchema = z.object({
  blocked_user_id: z.string().uuid(),
  handle: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: z.string(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

export const listBlocksResponseSchema = apiEnvelopeSchema(z.object({ items: z.array(blockedUserSchema) }));
export type ListBlocksResponse = z.infer<typeof listBlocksResponseSchema>;

export const blockResultSchema = z.object({ blocked_user_id: z.string().uuid() });
export type BlockResult = z.infer<typeof blockResultSchema>;
export const blockResultResponseSchema = apiEnvelopeSchema(blockResultSchema);
export type BlockResultResponse = z.infer<typeof blockResultResponseSchema>;

// ---------------------------------------------------------------------------
// Admin — reports moderation queue (the Review Queue's "Reports" tab)
// ---------------------------------------------------------------------------
export const reportedContentPreviewSchema = z.object({
  target_type: reportTargetTypeSchema,
  target_id: z.string().uuid(),
  /** Thread title, or the post body (truncated server-side if very long). */
  preview_text: z.string(),
  author: communityAuthorSchema,
  moderation_status: moderationStatusSchema,
});
export type ReportedContentPreview = z.infer<typeof reportedContentPreviewSchema>;

export const reportQueueItemSchema = z.object({
  /** Composite `${target_type}:${target_id}` key — not a uuid on its own. */
  id: z.string(),
  target_type: reportTargetTypeSchema,
  target_id: z.string().uuid(),
  reason: reportReasonSchema,
  detail: z.string().nullable(),
  status: reportStatusSchema,
  reporter_count: z.number().int(),
  content: reportedContentPreviewSchema.nullable(),
  created_at: z.string(),
});
export type ReportQueueItem = z.infer<typeof reportQueueItemSchema>;

export const reportsQueueQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
export type ReportsQueueQuery = z.infer<typeof reportsQueueQuerySchema>;

export const reportsQueueResponseSchema = apiEnvelopeSchema(paginatedSchema(reportQueueItemSchema));
export type ReportsQueueResponse = z.infer<typeof reportsQueueResponseSchema>;

export const reportActionSchema = z.enum(["dismiss", "remove_content", "lock_thread"]);
export type ReportAction = z.infer<typeof reportActionSchema>;

export const resolveReportBodySchema = z.object({ action: reportActionSchema });
export type ResolveReportBody = z.infer<typeof resolveReportBodySchema>;

export const reportActionResultSchema = z.object({
  /** Composite `${target_type}:${target_id}` key — not a uuid on its own. */
  id: z.string(),
  status: reportStatusSchema,
});
export const reportActionResponseSchema = apiEnvelopeSchema(reportActionResultSchema);
export type ReportActionResponse = z.infer<typeof reportActionResponseSchema>;
