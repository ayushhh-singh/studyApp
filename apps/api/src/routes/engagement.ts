import { Router } from "express";
import { z } from "zod";
import {
  activityHeatmapResponseSchema,
  leaderboardResponseSchema,
  localeSchema,
  milestoneListResponseSchema,
  milestoneResponseSchema,
  weeklyDigestResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { evaluateMilestones, listUnseenMilestones, markMilestoneSeen } from "../services/milestones.js";
import { getLeaderboard, getWeeklyDigest } from "../services/digest.js";
import { getActivityHeatmap } from "../services/daily-stats.js";
import { renderWeeklyDigestPng } from "../services/share-image.js";

export const engagementRouter = Router();
engagementRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

engagementRouter.get(
  "/milestones",
  asyncHandler(async (_req, res) => {
    const userId = devUserId();
    await evaluateMilestones(userId); // award anything newly crossed before listing
    const items = await listUnseenMilestones(userId);
    res.json(milestoneListResponseSchema.parse({ data: items, error: null }));
  }),
);

engagementRouter.post(
  "/milestones/:id/seen",
  asyncHandler(async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const m = await markMilestoneSeen(devUserId(), id);
    res.json(milestoneResponseSchema.parse({ data: m, error: null }));
  }),
);

engagementRouter.get(
  "/engagement/heatmap",
  asyncHandler(async (req, res) => {
    const { weeks } = parse(z.object({ weeks: z.coerce.number().int().optional() }), req.query);
    const heatmap = await getActivityHeatmap(devUserId(), weeks ?? 13);
    res.json(activityHeatmapResponseSchema.parse({ data: heatmap, error: null }));
  }),
);

engagementRouter.get(
  "/digest/weekly",
  asyncHandler(async (_req, res) => {
    const digest = await getWeeklyDigest(devUserId());
    res.json(weeklyDigestResponseSchema.parse({ data: digest, error: null }));
  }),
);

/** Server-rendered share image (PNG). Doubles as the OG-card generator later. */
engagementRouter.get(
  "/share/weekly.png",
  asyncHandler(async (req, res) => {
    const { locale } = parse(z.object({ locale: localeSchema.default("en") }), req.query);
    const digest = await getWeeklyDigest(devUserId());
    const png = await renderWeeklyDigestPng(digest, locale);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(png);
  }),
);

/** Leaderboard — built but intentionally NOT linked in nav (hidden until opt-in social). */
engagementRouter.get(
  "/leaderboard",
  asyncHandler(async (_req, res) => {
    const entries = await getLeaderboard(devUserId());
    res.json(leaderboardResponseSchema.parse({ data: entries, error: null }));
  }),
);
