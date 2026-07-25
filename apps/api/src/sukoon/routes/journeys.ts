/**
 * Sukoon F7 — Guided Journeys routes, mounted under /api/sukoon (see
 * routes/index.ts). Owner-scoped by currentUserId(). Admin authoring lives in
 * routes/admin-journeys.ts (a separate router) — this file is read/progress
 * only, matching the F6 exercises split (catalog+sessions here, seed content
 * is operator-authored elsewhere).
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonJourneysResponseSchema,
  sukoonJourneyDetailResponseSchema,
  sukoonJourneyProgressResponseSchema,
  sukoonJourneyTodayResponseSchema,
  sukoonJourneyCompleteStepBodySchema,
  sukoonJourneyReflectionBodySchema,
  sukoonJourneySlugSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireActiveSukoonAccount } from "../lib/require-active-account.js";
import { currentUserId } from "../../lib/user-context.js";
import {
  listJourneys,
  getJourneyDetail,
  startJourney,
  getTodayState,
  completeJourneyStep,
  saveJourneyReflection,
} from "../services/journeys.js";

export const sukoonJourneysRouter = Router();
sukoonJourneysRouter.use(requireAuth);
sukoonJourneysRouter.use(requireActiveSukoonAccount);
sukoonJourneysRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

const slugParamSchema = z.object({ slug: sukoonJourneySlugSchema });
const stepParamSchema = z.object({ slug: sukoonJourneySlugSchema, stepId: z.string().uuid() });

sukoonJourneysRouter.get(
  "/journeys",
  asyncHandler(async (_req, res) => {
    const journeys = await listJourneys(currentUserId());
    res.json(sukoonJourneysResponseSchema.parse({ data: { journeys }, error: null }));
  }),
);

sukoonJourneysRouter.get(
  "/journeys/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const result = await getJourneyDetail(currentUserId(), slug);
    res.json(sukoonJourneyDetailResponseSchema.parse({ data: result, error: null }));
  }),
);

sukoonJourneysRouter.post(
  "/journeys/:slug/start",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const progress = await startJourney(currentUserId(), slug);
    res.status(201).json(sukoonJourneyProgressResponseSchema.parse({ data: { progress }, error: null }));
  }),
);

sukoonJourneysRouter.get(
  "/journeys/:slug/today",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const result = await getTodayState(currentUserId(), slug);
    res.json(sukoonJourneyTodayResponseSchema.parse({ data: result, error: null }));
  }),
);

sukoonJourneysRouter.post(
  "/journeys/:slug/steps/:stepId/complete",
  asyncHandler(async (req, res) => {
    const { slug, stepId } = parse(stepParamSchema, req.params);
    const body = parse(sukoonJourneyCompleteStepBodySchema, req.body ?? {});
    const result = await completeJourneyStep(currentUserId(), slug, stepId, body);
    res.json(sukoonJourneyTodayResponseSchema.parse({ data: result, error: null }));
  }),
);

sukoonJourneysRouter.post(
  "/journeys/:slug/reflection",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const body = parse(sukoonJourneyReflectionBodySchema, req.body);
    const progress = await saveJourneyReflection(currentUserId(), slug, body.reflection);
    res.json(sukoonJourneyProgressResponseSchema.parse({ data: { progress }, error: null }));
  }),
);
