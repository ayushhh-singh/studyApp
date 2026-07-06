import { Router } from "express";
import { z } from "zod";
import { dailyQuizArchiveResponseSchema, testDetailResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { examCutoffsResponseSchema } from "@prayasup/shared";
import { DAILY_ARCHIVE_PAGE_SIZE, ensureTodayQuiz, listDailyQuizzes } from "../services/daily.js";
import { getTestDetail } from "../services/tests.js";
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
 * Ensure today's quiz exists and return its detail — lets the "Today" card
 * self-heal if the 5:00 AM IST job hasn't run yet in this dev process.
 */
dailyRouter.post(
  "/daily-quiz/today",
  asyncHandler(async (_req, res) => {
    const testId = await ensureTodayQuiz(devUserId());
    if (!testId) {
      // No questions available to build from — a valid, graceful empty result.
      res.json({ data: null, error: null });
      return;
    }
    const test = await getTestDetail(testId);
    res.json(testDetailResponseSchema.parse({ data: test, error: null }));
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
