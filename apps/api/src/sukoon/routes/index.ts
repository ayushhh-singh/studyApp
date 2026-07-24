import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { sukoonConfig } from "../config.js";
import { sukoonProfileRouter } from "./profile.js";

// Mounted directly at /api/sukoon (not /api/v1) — Sukoon is a self-contained
// module (CLAUDE.md's Sukoon architecture rules) that must stay mountable
// into any Express app unchanged, so it deliberately doesn't share Neev's
// /api/v1 namespace or its requireAuth-first ordering. /health stays public;
// the feature routers (profile/onboarding, ...) attach requireAuth themselves.
export const sukoonRouter = Router();

sukoonRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({ data: { ok: true, mode: sukoonConfig.mode }, error: null });
  }),
);

sukoonRouter.use(sukoonProfileRouter);
