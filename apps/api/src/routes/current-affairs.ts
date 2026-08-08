import { Router } from "express";
import {
  currentAffairsItemResponseSchema,
  currentAffairsQuerySchema,
  currentAffairsQuizBodySchema,
  currentAffairsDailySetsResponseSchema,
  currentAffairsQuizResponseSchema,
  currentAffairsResponseSchema,
  currentAffairsWeeklySetsResponseSchema,
} from "@neev/shared";
import { getUserExam } from "../lib/exams.js";
import { currentUserId } from "../lib/user-context.js";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { touchFeatureOnRequest } from "../lib/feature-touch.js";
import {
  CURRENT_AFFAIRS_PAGE_SIZE,
  getCurrentAffairsItemById,
  listCurrentAffairs,
} from "../services/current-affairs.js";
import { getDailyCaSets, getWeeklyCaSets } from "../ca/assemble.js";
import { createCustomTestFromCurrentAffairs } from "../services/tests.js";

export const currentAffairsRouter = Router();
currentAffairsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));
currentAffairsRouter.use(touchFeatureOnRequest("current_affairs"));

currentAffairsRouter.get(
  "/current-affairs",
  asyncHandler(async (req, res) => {
    const query = parse(currentAffairsQuerySchema, req.query);
    const { items, total } = await listCurrentAffairs(await getUserExam(currentUserId()), query);
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
    const sets = await getWeeklyCaSets(await getUserExam(currentUserId()));
    res.json(currentAffairsWeeklySetsResponseSchema.parse({ data: sets, error: null }));
  }),
);

// Registered BEFORE `/current-affairs/:id` — that catch-all would otherwise
// match "daily-sets" as an item id and 404 (the same ordering the weekly route
// above already depends on).
currentAffairsRouter.get(
  "/current-affairs/daily-sets",
  asyncHandler(async (_req, res) => {
    const sets = await getDailyCaSets(await getUserExam(currentUserId()));
    res.json(currentAffairsDailySetsResponseSchema.parse({ data: sets, error: null }));
  }),
);

currentAffairsRouter.get(
  "/current-affairs/:id",
  asyncHandler(async (req, res) => {
    const item = await getCurrentAffairsItemById(await getUserExam(currentUserId()), req.params.id);
    res.json(currentAffairsItemResponseSchema.parse({ data: item, error: null }));
  }),
);
