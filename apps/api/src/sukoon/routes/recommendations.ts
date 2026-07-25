/**
 * Sukoon "For you" recommendations route, mounted under /api/sukoon (see
 * routes/index.ts). Owner-scoped by currentUserId(). One cheap read (one
 * embedding of the user's signal + a cosine match over static content) — a
 * wider rate window like the exercises grid, well under abuse territory.
 */
import { Router } from "express";
import { z } from "zod";
import { sukoonRecommendationsResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getRecommendations } from "../services/recommendations.js";

export const sukoonRecommendationsRouter = Router();
sukoonRecommendationsRouter.use(requireAuth);
sukoonRecommendationsRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(4),
});

sukoonRecommendationsRouter.get(
  "/recommendations",
  asyncHandler(async (req, res) => {
    const { limit } = parse(querySchema, req.query);
    const result = await getRecommendations(currentUserId(), limit);
    res.json(sukoonRecommendationsResponseSchema.parse({ data: result, error: null }));
  }),
);
