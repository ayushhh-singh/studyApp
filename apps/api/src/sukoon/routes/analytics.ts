import { Router } from "express";
import { sukoonAnalyticsEventBodySchema, sukoonAnalyticsEventResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { recordSukoonEvent } from "../services/analytics.js";

/**
 * Session 14 — the client's half of privacy-aware analytics (activation
 * funnel steps, DAU/feature-usage pings, paywall views). Most cap-hit/crisis/
 * conversion events are recorded server-side at the point they actually
 * happen (chat/voice/journeys/billing services) — this route is for signals
 * only the client can observe (a page mounted, an onboarding step rendered).
 */
export const sukoonAnalyticsRouter = Router();
sukoonAnalyticsRouter.use(requireAuth);
sukoonAnalyticsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

sukoonAnalyticsRouter.post(
  "/analytics/events",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonAnalyticsEventBodySchema, req.body);
    await recordSukoonEvent(currentUserId(), body.name, body.props ?? {});
    res.status(201).json(sukoonAnalyticsEventResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);
