/**
 * Sukoon F5 — Mood tracking routes, mounted under /api/sukoon (see routes/index.ts).
 * Owner-scoped by currentUserId(); a 10-second flow, so no SSE here.
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonMoodCreateBodySchema,
  sukoonMoodUpdateBodySchema,
  sukoonMoodEntryResponseSchema,
  sukoonMoodDeleteResponseSchema,
  sukoonMoodTodayResponseSchema,
  sukoonMoodHeatmapResponseSchema,
  sukoonMoodAggregatesResponseSchema,
  sukoonMoodAggregatesRangeSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { createEntry, updateEntry, deleteEntry, getToday, heatmap, aggregates } from "../services/mood.js";

export const sukoonMoodRouter = Router();
sukoonMoodRouter.use(requireAuth);
// A check-in is a single small form, occasionally an extra one the same day —
// a wide window comfortably covers normal use without gating the flow.
sukoonMoodRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const monthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"),
});
const aggregatesQuerySchema = z.object({
  range: sukoonMoodAggregatesRangeSchema.default("30"),
});
const idParamSchema = z.object({ id: z.string().uuid() });

// --- Today (primary + extra check-ins + next-reminder) ----------------------
sukoonMoodRouter.get(
  "/mood/today",
  asyncHandler(async (_req, res) => {
    const today = await getToday(currentUserId());
    res.json(sukoonMoodTodayResponseSchema.parse({ data: today, error: null }));
  }),
);

// --- Aggregates (daily series, 7/30d avg, emotion frequency, correlations) --
sukoonMoodRouter.get(
  "/mood/aggregates",
  asyncHandler(async (req, res) => {
    const { range } = parse(aggregatesQuerySchema, req.query);
    const result = await aggregates(currentUserId(), Number(range));
    res.json(sukoonMoodAggregatesResponseSchema.parse({ data: result, error: null }));
  }),
);

// --- Calendar heatmap ---------------------------------------------------------
sukoonMoodRouter.get(
  "/mood/heatmap",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthSchema, req.query);
    const days = await heatmap(currentUserId(), month);
    res.json(sukoonMoodHeatmapResponseSchema.parse({ data: { month, days }, error: null }));
  }),
);

// --- Create -------------------------------------------------------------------
sukoonMoodRouter.post(
  "/mood/entries",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonMoodCreateBodySchema, req.body);
    const entry = await createEntry(currentUserId(), body);
    res.status(201).json(sukoonMoodEntryResponseSchema.parse({ data: { entry }, error: null }));
  }),
);

// --- Update (edit today's primary entry, or any of the user's own entries) ---
sukoonMoodRouter.patch(
  "/mood/entries/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(sukoonMoodUpdateBodySchema, req.body);
    const entry = await updateEntry(currentUserId(), id, body);
    res.json(sukoonMoodEntryResponseSchema.parse({ data: { entry }, error: null }));
  }),
);

// --- Delete -------------------------------------------------------------------
sukoonMoodRouter.delete(
  "/mood/entries/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    await deleteEntry(currentUserId(), id);
    res.json(sukoonMoodDeleteResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);
