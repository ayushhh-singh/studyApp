import { Router } from "express";
import { z } from "zod";
import { dailyQuizArchiveResponseSchema, dailyQuizzesTodayResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { examCutoffsResponseSchema } from "@neev/shared";
import { DAILY_ARCHIVE_PAGE_SIZE, ensureTodayQuizzes, listDailyQuizzes } from "../services/daily.js";
import { getCutoffs } from "../services/mocks.js";

export const dailyRouter = Router();
dailyRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

dailyRouter.get(
  "/daily-quiz/archive",
  asyncHandler(async (req, res) => {
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
    const { items, total } = await listDailyQuizzes(page);
    res.json(
      dailyQuizArchiveResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: DAILY_ARCHIVE_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / DAILY_ARCHIVE_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

/**
 * Ensure both of today's quizzes (GS + CSAT) exist and return their summaries —
 * lets the "Today" card and Practice > Daily Quiz panel self-heal if the 5:00 AM
 * IST job hasn't run yet in this dev process. Either summary may be null if a
 * variant has no questions to build from.
 */
dailyRouter.post(
  "/daily-quiz/today",
  asyncHandler(async (_req, res) => {
    const quizzes = await ensureTodayQuizzes();
    res.json(dailyQuizzesTodayResponseSchema.parse({ data: quizzes, error: null }));
  }),
);

dailyRouter.get(
  "/mocks/cutoffs",
  asyncHandler(async (req, res) => {
    const { exam } = parse(z.object({ exam: z.string().default("PRE_GS1") }), req.query);
    const cutoffs = await getCutoffs(exam);
    res.json(examCutoffsResponseSchema.parse({ data: cutoffs, error: null }));
  }),
);
