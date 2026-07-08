import { Router } from "express";
import {
  onboardingBodySchema,
  profileAnalyticsResponseSchema,
  profileResponseSchema,
  profileUpdateBodySchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { completeOnboarding, exportUserData, getProfile, updateProfile } from "../services/profile.js";
import { getProfileAnalytics } from "../services/profile-analytics.js";

export const profileRouter = Router();
profileRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

profileRouter.get(
  "/profile",
  asyncHandler(async (_req, res) => {
    const profile = await getProfile(currentUserId());
    res.json(profileResponseSchema.parse({ data: profile, error: null }));
  }),
);

profileRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const body = parse(profileUpdateBodySchema, req.body);
    const profile = await updateProfile(currentUserId(), body);
    res.json(profileResponseSchema.parse({ data: profile, error: null }));
  }),
);

profileRouter.post(
  "/profile/onboarding",
  asyncHandler(async (req, res) => {
    const body = parse(onboardingBodySchema, req.body);
    const profile = await completeOnboarding(currentUserId(), body);
    res.json(profileResponseSchema.parse({ data: profile, error: null }));
  }),
);

profileRouter.get(
  "/profile/analytics",
  asyncHandler(async (_req, res) => {
    const analytics = await getProfileAnalytics(currentUserId());
    res.json(profileAnalyticsResponseSchema.parse({ data: analytics, error: null }));
  }),
);

/** Raw data-portability export — not the {data,error} envelope's typed contract, a direct download. */
profileRouter.get(
  "/profile/export",
  asyncHandler(async (_req, res) => {
    const exportData = await exportUserData(currentUserId());
    res.setHeader("Content-Disposition", 'attachment; filename="prayasup-export.json"');
    res.json({ data: exportData, error: null });
  }),
);
