import { Router } from "express";
import { tourStateResponseSchema, tourUpdateBodySchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { getTourState, updateTourState } from "../services/tour.js";

export const tourRouter = Router();
tourRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

tourRouter.get(
  "/tour",
  asyncHandler(async (_req, res) => {
    const payload = await getTourState(currentUserId());
    res.json(tourStateResponseSchema.parse({ data: payload, error: null }));
  }),
);

tourRouter.patch(
  "/tour",
  asyncHandler(async (req, res) => {
    const body = parse(tourUpdateBodySchema, req.body);
    const payload = await updateTourState(currentUserId(), body);
    res.json(tourStateResponseSchema.parse({ data: payload, error: null }));
  }),
);
