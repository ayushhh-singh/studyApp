import { Router } from "express";
import {
  createDrillBodySchema,
  drillHistoryResponseSchema,
  drillRecommendationResponseSchema,
  drillSessionResponseSchema,
  submitDrillResponsesBodySchema,
} from "@neev/shared";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import {
  createDrillSession,
  deleteDrillSession,
  getDrillHistory,
  getRecommendation,
  saveDrillResponses,
} from "../services/micro-drills.js";

export const drillsRouter = Router();
drillsRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

drillsRouter.get(
  "/drills/recommendation",
  asyncHandler(async (_req, res) => {
    const recommendation = await getRecommendation(currentUserId());
    res.json(drillRecommendationResponseSchema.parse({ data: recommendation, error: null }));
  }),
);

drillsRouter.post(
  "/drills",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const body = parse(createDrillBodySchema, req.body);
    const session = await createDrillSession(currentUserId(), body.drill_type);
    res.json(drillSessionResponseSchema.parse({ data: session, error: null }));
  }),
);

const drillParamsSchema = z.object({ id: z.string().uuid() });

drillsRouter.patch(
  "/drills/:id/responses",
  asyncHandler(async (req, res) => {
    const { id } = parse(drillParamsSchema, req.params);
    const body = parse(submitDrillResponsesBodySchema, req.body);
    const session = await saveDrillResponses(currentUserId(), id, body.responses);
    res.json(drillSessionResponseSchema.parse({ data: session, error: null }));
  }),
);

drillsRouter.get(
  "/drills/history",
  asyncHandler(async (_req, res) => {
    const history = await getDrillHistory(currentUserId());
    res.json(drillHistoryResponseSchema.parse({ data: history, error: null }));
  }),
);

drillsRouter.delete(
  "/drills/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(drillParamsSchema, req.params);
    await deleteDrillSession(currentUserId(), id);
    res.status(204).end();
  }),
);
