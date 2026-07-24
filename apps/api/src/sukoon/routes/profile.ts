import { Router } from "express";
import {
  sukoonOnboardingBodySchema,
  sukoonProfileResponseSchema,
  sukoonProfileUpdateBodySchema,
  sukoonProfileWriteResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import {
  completeSukoonOnboarding,
  getSukoonProfile,
  updateSukoonProfile,
} from "../services/profile.js";

/**
 * Sukoon profile + onboarding. Mounted under /api/sukoon (NOT /api/v1), which
 * sits OUTSIDE Neev's global requireAuth ordering — so these routes attach
 * requireAuth themselves, reusing the same shared middleware (JWT verify →
 * currentUserId() via AsyncLocalStorage). The public /health probe in
 * routes/index.ts stays unauthenticated.
 */
export const sukoonProfileRouter = Router();
sukoonProfileRouter.use(requireAuth);
sukoonProfileRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

sukoonProfileRouter.get(
  "/profile",
  asyncHandler(async (_req, res) => {
    const profile = await getSukoonProfile(currentUserId());
    res.json(sukoonProfileResponseSchema.parse({ data: { profile }, error: null }));
  }),
);

sukoonProfileRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonProfileUpdateBodySchema, req.body);
    const profile = await updateSukoonProfile(currentUserId(), body);
    res.json(sukoonProfileWriteResponseSchema.parse({ data: profile, error: null }));
  }),
);

sukoonProfileRouter.post(
  "/onboarding",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonOnboardingBodySchema, req.body);
    const profile = await completeSukoonOnboarding(currentUserId(), body);
    res.json(sukoonProfileWriteResponseSchema.parse({ data: profile, error: null }));
  }),
);
