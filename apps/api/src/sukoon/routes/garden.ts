/**
 * Sukoon F11 — Garden route, mounted under /api/sukoon (see routes/index.ts).
 * A single cheap read — no writes, since growth_points is always derived
 * live from other tables (see services/garden.ts's header).
 */
import { Router } from "express";
import { sukoonGardenResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getGardenState } from "../services/garden.js";

export const sukoonGardenRouter = Router();
sukoonGardenRouter.use(requireAuth);
sukoonGardenRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

sukoonGardenRouter.get(
  "/garden",
  asyncHandler(async (_req, res) => {
    const state = await getGardenState(currentUserId());
    res.json(sukoonGardenResponseSchema.parse({ data: state, error: null }));
  }),
);
