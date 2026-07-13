import { Router } from "express";
import { z } from "zod";
import {
  answerSessionDetailResponseSchema,
  answerSessionResponseSchema,
  answerSessionResultResponseSchema,
  startAnswerSessionBodySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { finishAnswerSession, getAnswerSession, getAnswerSessionResult, startAnswerSession } from "../services/answer-sessions.js";

export const answerSessionsRouter = Router();
answerSessionsRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const sessionIdParams = z.object({ id: z.string().uuid() });

answerSessionsRouter.post(
  "/answer-sessions",
  asyncHandler(async (req, res) => {
    const body = parse(startAnswerSessionBodySchema, req.body);
    const session = await startAnswerSession(currentUserId(), body.test_id);
    res.status(201).json(answerSessionResponseSchema.parse({ data: session, error: null }));
  }),
);

answerSessionsRouter.get(
  "/answer-sessions/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(sessionIdParams, req.params);
    const detail = await getAnswerSession(currentUserId(), id);
    res.json(answerSessionDetailResponseSchema.parse({ data: detail, error: null }));
  }),
);

answerSessionsRouter.post(
  "/answer-sessions/:id/finish",
  asyncHandler(async (req, res) => {
    const { id } = parse(sessionIdParams, req.params);
    const session = await finishAnswerSession(currentUserId(), id);
    res.json(answerSessionResponseSchema.parse({ data: session, error: null }));
  }),
);

answerSessionsRouter.get(
  "/answer-sessions/:id/result",
  asyncHandler(async (req, res) => {
    const { id } = parse(sessionIdParams, req.params);
    const result = await getAnswerSessionResult(currentUserId(), id);
    res.json(answerSessionResultResponseSchema.parse({ data: result, error: null }));
  }),
);
