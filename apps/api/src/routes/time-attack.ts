import { Router } from "express";
import { z } from "zod";
import {
  timeAttackFinishBodySchema,
  timeAttackResultResponseSchema,
  timeAttackStartBodySchema,
  timeAttackStartResponseSchema,
  timeAttackTopicsQuerySchema,
  timeAttackTopicsResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { finishTimeAttack, getTimeAttackTopics, startTimeAttack } from "../services/time-attack.js";

export const timeAttackRouter = Router();
timeAttackRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

timeAttackRouter.get(
  "/time-attack/topics",
  asyncHandler(async (req, res) => {
    const { paper } = parse(timeAttackTopicsQuerySchema, req.query);
    const topics = await getTimeAttackTopics(currentUserId(), paper);
    res.json(timeAttackTopicsResponseSchema.parse({ data: topics, error: null }));
  }),
);

timeAttackRouter.post(
  "/time-attack",
  asyncHandler(async (req, res) => {
    const { node_id } = parse(timeAttackStartBodySchema, req.body);
    const start = await startTimeAttack(currentUserId(), node_id);
    res.status(201).json(timeAttackStartResponseSchema.parse({ data: start, error: null }));
  }),
);

timeAttackRouter.post(
  "/time-attack/:attemptId/finish",
  asyncHandler(async (req, res) => {
    const { attemptId } = parse(z.object({ attemptId: z.string().uuid() }), req.params);
    const { combo_best } = parse(timeAttackFinishBodySchema, req.body);
    const result = await finishTimeAttack(currentUserId(), attemptId, combo_best);
    res.json(timeAttackResultResponseSchema.parse({ data: result, error: null }));
  }),
);
