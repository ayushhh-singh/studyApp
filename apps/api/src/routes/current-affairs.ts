import { Router } from "express";
import { currentAffairsQuerySchema, currentAffairsResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { CURRENT_AFFAIRS_PAGE_SIZE, listCurrentAffairs } from "../services/current-affairs.js";

export const currentAffairsRouter = Router();
currentAffairsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

currentAffairsRouter.get(
  "/current-affairs",
  asyncHandler(async (req, res) => {
    const query = parse(currentAffairsQuerySchema, req.query);
    const { items, total } = await listCurrentAffairs(query);
    res.json(
      currentAffairsResponseSchema.parse({
        data: {
          items,
          pagination: {
            page: query.page,
            page_size: CURRENT_AFFAIRS_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / CURRENT_AFFAIRS_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);
