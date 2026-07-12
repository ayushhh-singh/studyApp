import { Router } from "express";
import { z } from "zod";
import {
  blockResultResponseSchema,
  blockUserBodySchema,
  communityHubResponseSchema,
  communityThreadsQuerySchema,
  createDiscussionPostBodySchema,
  createDiscussionThreadBodySchema,
  discussionPostResponseSchema,
  discussionThreadDetailResponseSchema,
  discussionThreadResponseSchema,
  listBlocksResponseSchema,
  listDiscussionThreadsResponseSchema,
  listSharedAnswersResponseSchema,
  postsQuerySchema,
  reportContentBodySchema,
  reportResultResponseSchema,
  shareAnswerBodySchema,
  sharedAnswerResponseSchema,
  sharedAnswersQuerySchema,
  updateDiscussionPostBodySchema,
  voteResultResponseSchema,
  votePostBodySchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { touchFeatureOnRequest } from "../lib/feature-touch.js";
import {
  addPost,
  blockUser,
  createThread,
  deletePost,
  editPost,
  getCommunityHub,
  getSharedAnswer,
  getThreadDetail,
  listBlocks,
  listSharedAnswers,
  listThreadsForAnchor,
  reportContent,
  shareAnswerForPeerReview,
  unblockUser,
  votePost,
} from "../services/community.js";

export const communityRouter = Router();
communityRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));
communityRouter.use(touchFeatureOnRequest("community"));
// Posting is rate-limited more tightly than reads — the non-negotiable
// per-user posts/hour cap (CLAUDE.md's moderation requirement). Applied only
// to the two content-creation routes below, NOT router.use()'d onto the
// "/community/threads"/"/community/posts" path prefixes — those prefixes also
// cover GET (listing threads, reading a thread's posts), and a path-prefix
// limiter would silently burn a user's post budget just from browsing.
const postCreationLimit = rateLimit({ windowMs: 3_600_000, max: 30 });

const idParams = z.object({ id: z.string().uuid() });

communityRouter.get(
  "/community/hub",
  asyncHandler(async (_req, res) => {
    const hub = await getCommunityHub(currentUserId());
    res.json(communityHubResponseSchema.parse({ data: hub, error: null }));
  }),
);

communityRouter.get(
  "/community/threads",
  asyncHandler(async (req, res) => {
    const query = parse(communityThreadsQuerySchema, req.query);
    const result = await listThreadsForAnchor(currentUserId(), query.anchor_type, query.anchor_id, query.page);
    res.json(listDiscussionThreadsResponseSchema.parse({ data: result, error: null }));
  }),
);

communityRouter.post(
  "/community/threads",
  postCreationLimit,
  asyncHandler(async (req, res) => {
    const body = parse(createDiscussionThreadBodySchema, req.body);
    const thread = await createThread(currentUserId(), body.anchor_type, body.anchor_id, body.title, body.body);
    res.status(201).json(discussionThreadResponseSchema.parse({ data: thread, error: null }));
  }),
);

communityRouter.get(
  "/community/threads/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const query = parse(postsQuerySchema, req.query);
    const detail = await getThreadDetail(currentUserId(), id, query.page);
    res.json(discussionThreadDetailResponseSchema.parse({ data: detail, error: null }));
  }),
);

communityRouter.post(
  "/community/threads/:id/posts",
  postCreationLimit,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(createDiscussionPostBodySchema, req.body);
    const post = await addPost(currentUserId(), id, body.body);
    res.status(201).json(discussionPostResponseSchema.parse({ data: post, error: null }));
  }),
);

communityRouter.patch(
  "/community/posts/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(updateDiscussionPostBodySchema, req.body);
    const post = await editPost(currentUserId(), id, body.body);
    res.json(discussionPostResponseSchema.parse({ data: post, error: null }));
  }),
);

communityRouter.delete(
  "/community/posts/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    await deletePost(currentUserId(), id);
    res.status(204).end();
  }),
);

communityRouter.post(
  "/community/posts/:id/vote",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(votePostBodySchema, req.body);
    const result = await votePost(currentUserId(), id, body.value);
    res.json(voteResultResponseSchema.parse({ data: result, error: null }));
  }),
);

communityRouter.get(
  "/community/shared-answers",
  asyncHandler(async (req, res) => {
    const query = parse(sharedAnswersQuerySchema, req.query);
    const result = await listSharedAnswers(currentUserId(), query.page);
    res.json(listSharedAnswersResponseSchema.parse({ data: result, error: null }));
  }),
);

communityRouter.get(
  "/community/shared-answers/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const shared = await getSharedAnswer(id);
    res.json(sharedAnswerResponseSchema.parse({ data: shared, error: null }));
  }),
);

communityRouter.post(
  "/community/shared-answers",
  asyncHandler(async (req, res) => {
    const body = parse(shareAnswerBodySchema, req.body);
    const shared = await shareAnswerForPeerReview(currentUserId(), body.submission_id);
    res.status(201).json(sharedAnswerResponseSchema.parse({ data: shared, error: null }));
  }),
);

communityRouter.post(
  "/community/reports",
  asyncHandler(async (req, res) => {
    const body = parse(reportContentBodySchema, req.body);
    const result = await reportContent(currentUserId(), body.target_type, body.target_id, body.reason, body.detail);
    res.status(201).json(reportResultResponseSchema.parse({ data: result, error: null }));
  }),
);

communityRouter.get(
  "/community/blocks",
  asyncHandler(async (_req, res) => {
    const result = await listBlocks(currentUserId());
    res.json(listBlocksResponseSchema.parse({ data: result, error: null }));
  }),
);

communityRouter.post(
  "/community/blocks",
  asyncHandler(async (req, res) => {
    const body = parse(blockUserBodySchema, req.body);
    await blockUser(currentUserId(), body.blocked_user_id);
    res.status(201).json(
      blockResultResponseSchema.parse({ data: { blocked_user_id: body.blocked_user_id }, error: null }),
    );
  }),
);

communityRouter.delete(
  "/community/blocks/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    await unblockUser(currentUserId(), id);
    res.status(204).end();
  }),
);
