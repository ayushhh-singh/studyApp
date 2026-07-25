import { Router } from "express";
import { sukoonFeedbackSubmitBodySchema, sukoonFeedbackSubmitResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { submitSukoonFeedback } from "../services/feedback.js";

/**
 * Session 14 — the feedback widget's submit endpoint (thumbs on a Saathi
 * reply, a completed journey, or general feedback from the beta banner). The
 * admin list lives under routes/admin.ts (same is_admin gate as the journeys
 * queue), not here.
 */
export const sukoonFeedbackRouter = Router();
sukoonFeedbackRouter.use(requireAuth);
sukoonFeedbackRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

sukoonFeedbackRouter.post(
  "/feedback",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonFeedbackSubmitBodySchema, req.body);
    const item = await submitSukoonFeedback(currentUserId(), body);
    res.status(201).json(sukoonFeedbackSubmitResponseSchema.parse({ data: item, error: null }));
  }),
);
