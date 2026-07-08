import { Router } from "express";
import { profileAnalyticsResponseSchema, profileResponseSchema, profileUpdateBodySchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { exportUserData, getProfile, updateProfile } from "../services/profile.js";
import { getProfileAnalytics } from "../services/profile-analytics.js";

export const profileRouter = Router();
profileRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

profileRouter.get(
  "/profile",
  asyncHandler(async (_req, res) => {
    const profile = await getProfile(devUserId());
    res.json(profileResponseSchema.parse({ data: profile, error: null }));
  }),
);

profileRouter.patch(
  "/profile",
  asyncHandler(async (req, res) => {
    const body = parse(profileUpdateBodySchema, req.body);
    const profile = await updateProfile(devUserId(), body);
    res.json(profileResponseSchema.parse({ data: profile, error: null }));
  }),
);

profileRouter.get(
  "/profile/analytics",
  asyncHandler(async (_req, res) => {
    const analytics = await getProfileAnalytics(devUserId());
    res.json(profileAnalyticsResponseSchema.parse({ data: analytics, error: null }));
  }),
);

/** Raw data-portability export — not the {data,error} envelope's typed contract, a direct download. */
profileRouter.get(
  "/profile/export",
  asyncHandler(async (_req, res) => {
    const exportData = await exportUserData(devUserId());
    res.setHeader("Content-Disposition", 'attachment; filename="prayasup-export.json"');
    res.json({ data: exportData, error: null });
  }),
);
