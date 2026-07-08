import { Router } from "express";
import { z } from "zod";
import {
  timeAttackFinishBodySchema,
  timeAttackResultResponseSchema,
  timeAttackStartBodySchema,
  timeAttackStartResponseSchema,
  timeAttackTopicsResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { finishTimeAttack, getTimeAttackTopics, startTimeAttack } from "../services/time-attack.js";

export const timeAttackRouter = Router();
timeAttackRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

timeAttackRouter.get(
  "/time-attack/topics",
  asyncHandler(async (_req, res) => {
    const topics = await getTimeAttackTopics(devUserId());
    res.json(timeAttackTopicsResponseSchema.parse({ data: topics, error: null }));
  }),
);

timeAttackRouter.post(
  "/time-attack",
  asyncHandler(async (req, res) => {
    const { node_id } = parse(timeAttackStartBodySchema, req.body);
    const start = await startTimeAttack(devUserId(), node_id);
    res.status(201).json(timeAttackStartResponseSchema.parse({ data: start, error: null }));
  }),
);

timeAttackRouter.post(
  "/time-attack/:attemptId/finish",
  asyncHandler(async (req, res) => {
    const { attemptId } = parse(z.object({ attemptId: z.string().uuid() }), req.params);
    const { combo_best } = parse(timeAttackFinishBodySchema, req.body);
    const result = await finishTimeAttack(devUserId(), attemptId, combo_best);
    res.json(timeAttackResultResponseSchema.parse({ data: result, error: null }));
  }),
);
