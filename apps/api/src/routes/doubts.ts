import { Router } from "express";
import { z } from "zod";
import {
  createThreadBodySchema,
  doubtMessageResponseSchema,
  doubtThreadDetailResponseSchema,
  doubtThreadListResponseSchema,
  doubtThreadResponseSchema,
  learnerProfileResponseSchema,
  mentorInsightResponseSchema,
  mentorInsightsResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import {
  createThread,
  deleteThread,
  getThreadDetail,
  listThreads,
  runDoubtQuiz,
} from "../services/mentor/index.js";
import { dismissInsight, listInsights } from "../services/mentor-insights.js";
import { getLearnerProfile } from "../services/learner-profile.js";

/**
 * The AI Mentor's non-streaming endpoints: thread CRUD, the in-thread "quiz me"
 * action, proactive insight cards, and learner-profile refresh. The streamed
 * doubt answer lives at POST /stream/doubts/:threadId/messages (routes/stream.ts).
 */
export const doubtsRouter = Router();
doubtsRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const threadParams = z.object({ threadId: z.string().uuid() });
const insightParams = z.object({ id: z.string().uuid() });

doubtsRouter.post(
  "/doubts/threads",
  asyncHandler(async (req, res) => {
    const body = parse(createThreadBodySchema, req.body ?? {});
    const thread = await createThread(devUserId(), body.title);
    res.status(201).json(doubtThreadResponseSchema.parse({ data: thread, error: null }));
  }),
);

doubtsRouter.get(
  "/doubts/threads",
  asyncHandler(async (_req, res) => {
    const items = await listThreads(devUserId());
    res.json(doubtThreadListResponseSchema.parse({ data: { items }, error: null }));
  }),
);

doubtsRouter.get(
  "/doubts/threads/:threadId",
  asyncHandler(async (req, res) => {
    const { threadId } = parse(threadParams, req.params);
    const detail = await getThreadDetail(devUserId(), threadId);
    res.json(doubtThreadDetailResponseSchema.parse({ data: detail, error: null }));
  }),
);

doubtsRouter.delete(
  "/doubts/threads/:threadId",
  asyncHandler(async (req, res) => {
    const { threadId } = parse(threadParams, req.params);
    await deleteThread(devUserId(), threadId);
    res.status(204).end();
  }),
);

doubtsRouter.post(
  "/doubts/threads/:threadId/quiz",
  asyncHandler(async (req, res) => {
    const { threadId } = parse(threadParams, req.params);
    const message = await runDoubtQuiz(devUserId(), threadId);
    res.status(201).json(doubtMessageResponseSchema.parse({ data: message, error: null }));
  }),
);

doubtsRouter.get(
  "/mentor/insights",
  asyncHandler(async (_req, res) => {
    const insights = await listInsights(devUserId());
    res.json(mentorInsightsResponseSchema.parse({ data: { insights }, error: null }));
  }),
);

doubtsRouter.post(
  "/mentor/insights/:id/dismiss",
  asyncHandler(async (req, res) => {
    const { id } = parse(insightParams, req.params);
    const insight = await dismissInsight(devUserId(), id);
    res.json(mentorInsightResponseSchema.parse({ data: insight, error: null }));
  }),
);

doubtsRouter.post(
  "/mentor/profile/refresh",
  asyncHandler(async (_req, res) => {
    const profile = await getLearnerProfile(devUserId(), { refresh: true });
    res.json(learnerProfileResponseSchema.parse({ data: profile, error: null }));
  }),
);
