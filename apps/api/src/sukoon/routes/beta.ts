import { Router } from "express";
import { sukoonBetaStatusResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getSukoonBetaStatus } from "../services/beta.js";

/**
 * Session 14 — SUKOON_BETA_COHORT status probe. The frontend's gate for
 * whether to render the two access points (Neev homepage card, in-app nav
 * item) — mirrors GET /admin/status's shape (answers "am I in the cohort",
 * never denies the answer to whoever's asking).
 */
export const sukoonBetaRouter = Router();
sukoonBetaRouter.use(requireAuth);
sukoonBetaRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

sukoonBetaRouter.get(
  "/beta/status",
  asyncHandler(async (_req, res) => {
    const status = await getSukoonBetaStatus(currentUserId());
    res.json(sukoonBetaStatusResponseSchema.parse({ data: status, error: null }));
  }),
);
