import { Router } from "express";
import { profileResponseSchema, profileUpdateBodySchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getProfile, updateProfile } from "../services/profile.js";

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
