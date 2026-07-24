import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { sukoonConfig } from "../config.js";

// Mounted directly at /api/sukoon (not /api/v1) — Sukoon is a self-contained
// module (CLAUDE.md's Sukoon architecture rules) that must stay mountable
// into any Express app unchanged, so it deliberately doesn't share Neev's
// /api/v1 namespace or its requireAuth-first ordering. Session 1 is scaffold
// only: a liveness probe, no auth-gated routes yet.
export const sukoonRouter = Router();

sukoonRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({ data: { ok: true, mode: sukoonConfig.mode }, error: null });
  }),
);
