import { Router } from "express";
import {
  currentAffairsItemResponseSchema,
  currentAffairsQuerySchema,
  currentAffairsQuizBodySchema,
  currentAffairsQuizResponseSchema,
  currentAffairsResponseSchema,
  currentAffairsWeeklySetsResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { touchFeatureOnRequest } from "../lib/feature-touch.js";
import {
  CURRENT_AFFAIRS_PAGE_SIZE,
  getCurrentAffairsItemById,
  listCurrentAffairs,
} from "../services/current-affairs.js";
import { getWeeklyCaSets } from "../ca/assemble.js";
import { createCustomTestFromCurrentAffairs } from "../services/tests.js";

export const currentAffairsRouter = Router();
currentAffairsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));
currentAffairsRouter.use(touchFeatureOnRequest("current_affairs"));

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

currentAffairsRouter.post(
  "/current-affairs/quiz",
  asyncHandler(async (req, res) => {
    const body = parse(currentAffairsQuizBodySchema, req.body);
    const test = await createCustomTestFromCurrentAffairs(body.days);
    res.status(201).json(currentAffairsQuizResponseSchema.parse({ data: test, error: null }));
  }),
);

currentAffairsRouter.get(
  "/current-affairs/weekly-sets",
  asyncHandler(async (_req, res) => {
    const sets = await getWeeklyCaSets();
    res.json(currentAffairsWeeklySetsResponseSchema.parse({ data: sets, error: null }));
  }),
);

currentAffairsRouter.get(
  "/current-affairs/:id",
  asyncHandler(async (req, res) => {
    const item = await getCurrentAffairsItemById(req.params.id);
    res.json(currentAffairsItemResponseSchema.parse({ data: item, error: null }));
  }),
);
