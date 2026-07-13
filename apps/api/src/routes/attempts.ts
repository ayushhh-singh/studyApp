import { Router } from "express";
import { z } from "zod";
import {
  attemptAnswersBodySchema,
  attemptAnswersResponseSchema,
  attemptDetailResponseSchema,
  attemptListResponseSchema,
  attemptResponseSchema,
  attemptResultResponseSchema,
  attemptStartBodySchema,
  attemptSubmitResponseSchema,
  ghostStartResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { logger } from "../lib/logger.js";
import { recomputeMastery } from "../mastery/compute.js";
import {
  ATTEMPTS_PAGE_SIZE,
  getAttemptDetail,
  getAttemptResult,
  listAttempts,
  startAttempt,
  submitAttempt,
  upsertAttemptAnswers,
} from "../services/attempts.js";
import { startGhostBattle } from "../services/ghost.js";

export const attemptsRouter = Router();
attemptsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

const attemptIdParams = z.object({ id: z.string().uuid() });
const attemptListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });

attemptsRouter.get(
  "/attempts",
  asyncHandler(async (req, res) => {
    const { page } = parse(attemptListQuerySchema, req.query);
    const { items, total } = await listAttempts(currentUserId(), page);
    res.json(
      attemptListResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: ATTEMPTS_PAGE_SIZE,
            total,
            total_pages: Math.ceil(total / ATTEMPTS_PAGE_SIZE),
          },
        },
        error: null,
      }),
    );
  }),
);

attemptsRouter.post(
  "/attempts",
  asyncHandler(async (req, res) => {
    const body = parse(attemptStartBodySchema, req.body);
    const attempt = await startAttempt(currentUserId(), body);
    res.status(201).json(attemptResponseSchema.parse({ data: attempt, error: null }));
  }),
);

attemptsRouter.get(
  "/attempts/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(attemptIdParams, req.params);
    const detail = await getAttemptDetail(currentUserId(), id);
    res.json(attemptDetailResponseSchema.parse({ data: detail, error: null }));
  }),
);

attemptsRouter.post(
  "/attempts/:id/answers",
  asyncHandler(async (req, res) => {
    const { id } = parse(attemptIdParams, req.params);
    const body = parse(attemptAnswersBodySchema, req.body);
    const upserted = await upsertAttemptAnswers(currentUserId(), id, body.answers);
    res.json(attemptAnswersResponseSchema.parse({ data: { upserted }, error: null }));
  }),
);

attemptsRouter.get(
  "/attempts/:id/result",
  asyncHandler(async (req, res) => {
    const { id } = parse(attemptIdParams, req.params);
    const result = await getAttemptResult(currentUserId(), id);
    res.json(attemptResultResponseSchema.parse({ data: result, error: null }));
  }),
);

/** Ghost Battle — replay this completed attempt's question set, racing past-you. */
attemptsRouter.post(
  "/attempts/:id/ghost",
  asyncHandler(async (req, res) => {
    const { id } = parse(attemptIdParams, req.params);
    const start = await startGhostBattle(currentUserId(), id);
    res.status(201).json(ghostStartResponseSchema.parse({ data: start, error: null }));
  }),
);

attemptsRouter.post(
  "/attempts/:id/submit",
  asyncHandler(async (req, res) => {
    const { id } = parse(attemptIdParams, req.params);
    const userId = currentUserId();
    const result = await submitAttempt(userId, id);
    // Refresh mastery from the just-graded answers. Best-effort so a recompute
    // hiccup never fails the submit; the nightly job settles it regardless.
    recomputeMastery(userId).catch((err) => logger.error({ err }, "mastery: post-submit recompute failed"));
    res.json(attemptSubmitResponseSchema.parse({ data: result, error: null }));
  }),
);
