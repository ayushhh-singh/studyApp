import { Router } from "express";
import { z } from "zod";
import { apiEnvelopeSchema, testSeriesDetailSchema, testSeriesListResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { getSeriesBySlug, listSeries } from "../services/test-series.js";

export const testSeriesRouter = Router();
testSeriesRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

/**
 * The series a viewer may see — their own live exam's, published only (an admin
 * additionally sees drafts). Access is enforced in the service, not here, so
 * `startAttempt`'s gate and this listing cannot drift apart.
 */
testSeriesRouter.get(
  "/test-series",
  asyncHandler(async (_req, res) => {
    const series = await listSeries(currentUserId());
    res.json(testSeriesListResponseSchema.parse({ series }));
  }),
);

/** One series' published calendar, with each entry's derived per-user state. */
testSeriesRouter.get(
  "/test-series/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = parse(z.object({ slug: z.string().min(1) }), req.params);
    const detail = await getSeriesBySlug(currentUserId(), slug);
    res.json(apiEnvelopeSchema(testSeriesDetailSchema).parse({ data: detail, error: null }));
  }),
);
