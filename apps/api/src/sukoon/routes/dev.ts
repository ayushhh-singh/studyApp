import { Router } from "express";
import { sukoonCrisisAssessBodySchema, sukoonCrisisAssessResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { assessMessage } from "../services/crisis/engine.js";

/**
 * Dev-only crisis tooling (blueprint F3): a hidden probe that runs the live
 * detection engine on typed text and returns the assessment, powering the
 * frontend's /sukoon/dev/crisis page. Mounted ONLY when sukoonConfig.devTools
 * is on (see routes/index.ts) — a production boot never exposes it.
 *
 * Still behind requireAuth (assessMessage needs a real user id for the event
 * log + anti-doom-loop count) and rate-limited. Because it calls the real
 * engine, each probe DOES write a sukoon_crisis_events row and count toward the
 * tester's own 24h rate-limit — which is the point: it exercises the full path.
 */
export const sukoonDevRouter = Router();
sukoonDevRouter.use(requireAuth);
sukoonDevRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

sukoonDevRouter.post(
  "/dev/crisis/assess",
  asyncHandler(async (req, res) => {
    const { text } = parse(sukoonCrisisAssessBodySchema, req.body);
    const assessment = await assessMessage(currentUserId(), text);
    res.json(sukoonCrisisAssessResponseSchema.parse({ data: assessment, error: null }));
  }),
);
