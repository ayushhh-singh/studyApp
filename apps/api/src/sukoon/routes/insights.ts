/**
 * Sukoon F9 — Weekly Insights routes, mounted under /api/sukoon. Read-only from
 * the app's side: insights are WRITTEN by the Sunday cron, not on demand (a user
 * can't spend a Sonnet call by pressing a button). Owner-scoped by currentUserId().
 *
 * The free-user upsell SAMPLE is a static shared constant (SUKOON_SAMPLE_INSIGHT)
 * the FE renders directly — no endpoint needed, and no model call for a preview.
 */
import { Router } from "express";
import { sukoonInsightsResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireActiveSukoonAccount } from "../lib/require-active-account.js";
import { currentUserId } from "../../lib/user-context.js";
import { insightsEnabled, listInsights } from "../services/insights.js";
import { getSukoonTier } from "../services/entitlements.js";

export const sukoonInsightsRouter = Router();
sukoonInsightsRouter.use(requireAuth);
sukoonInsightsRouter.use(requireActiveSukoonAccount);
sukoonInsightsRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

// --- Feed (+ tier & enabled, so the FE shows the sample/upsell to free users) --
sukoonInsightsRouter.get(
  "/insights",
  asyncHandler(async (_req, res) => {
    const userId = currentUserId();
    const [insights, tier, enabled] = await Promise.all([
      listInsights(userId),
      getSukoonTier(userId),
      insightsEnabled(userId),
    ]);
    res.json(sukoonInsightsResponseSchema.parse({ data: { insights, tier, enabled }, error: null }));
  }),
);
