/**
 * Sukoon F8 — Wellbeing Check-in routes, mounted under /api/sukoon.
 * Owner-scoped by currentUserId(); short forms, so no SSE.
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonCheckinStatusResponseSchema,
  sukoonCheckinSubmitBodySchema,
  sukoonCheckinSubmitResponseSchema,
  sukoonCheckinTrendResponseSchema,
  sukoonCheckinTypeSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getCheckinStatus, getCheckinTrend, submitCheckin } from "../services/checkins.js";

export const sukoonCheckinsRouter = Router();
sukoonCheckinsRouter.use(requireAuth);
// A check-in is monthly-ish; a wide window comfortably covers real use.
sukoonCheckinsRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

const trendQuerySchema = z.object({ type: sukoonCheckinTypeSchema });

// --- Status (which check-ins are due) ---------------------------------------
sukoonCheckinsRouter.get(
  "/checkins/status",
  asyncHandler(async (_req, res) => {
    const items = await getCheckinStatus(currentUserId());
    res.json(sukoonCheckinStatusResponseSchema.parse({ data: { items }, error: null }));
  }),
);

// --- Trend (score history for one type) -------------------------------------
sukoonCheckinsRouter.get(
  "/checkins/trend",
  asyncHandler(async (req, res) => {
    const { type } = parse(trendQuerySchema, req.query);
    const points = await getCheckinTrend(currentUserId(), type);
    res.json(sukoonCheckinTrendResponseSchema.parse({ data: { type, points }, error: null }));
  }),
);

// --- Submit (score server-side, store, return low-flag) ---------------------
sukoonCheckinsRouter.post(
  "/checkins",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonCheckinSubmitBodySchema, req.body);
    const result = await submitCheckin(currentUserId(), body);
    res.status(201).json(sukoonCheckinSubmitResponseSchema.parse({ data: result, error: null }));
  }),
);
