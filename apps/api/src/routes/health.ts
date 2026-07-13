import { Router } from "express";
import { healthResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { getMentorCacheHealth } from "../services/mentor/cache-health.js";

export const healthRouter = Router();

healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    // Mentor FAQ-cache status is surfaced here (TTL-cached, so this stays a cheap
    // liveness probe) so a missing manual migration is visible without log-diving.
    const cache = await getMentorCacheHealth();
    const body = healthResponseSchema.parse({
      data: {
        ok: true,
        mentor_cache: { table_ok: cache.table_ok, rpc_ok: cache.rpc_ok, detail: cache.detail },
      },
      error: null,
    });
    res.json(body);
  }),
);
