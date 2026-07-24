import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { sukoonConfig } from "../config.js";
import { sukoonProfileRouter } from "./profile.js";
import { sukoonChatRouter } from "./chat.js";
import { sukoonJournalRouter } from "./journal.js";
import { sukoonMoodRouter } from "./mood.js";
import { sukoonExercisesRouter } from "./exercises.js";
import { sukoonDevRouter } from "./dev.js";

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
sukoonRouter.use(sukoonChatRouter);
sukoonRouter.use(sukoonJournalRouter);
sukoonRouter.use(sukoonMoodRouter);
sukoonRouter.use(sukoonExercisesRouter);

// Dev-only crisis probe — mounted ONLY when devTools is on (never in a plain
// production boot). Kept last so its /dev/* paths don't shadow anything.
if (sukoonConfig.devTools) {
  sukoonRouter.use(sukoonDevRouter);
}
