import { Router } from "express";
import { z } from "zod";
import { dailyQuizArchiveResponseSchema, dailyQuizzesTodayResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { examCutoffsResponseSchema } from "@neev/shared";
import { DAILY_ARCHIVE_PAGE_SIZE, ensureTodayQuizzes, listDailyQuizzes } from "../services/daily.js";
import { getCutoffs } from "../services/mocks.js";
import { getUserExam } from "../lib/exams.js";
import { currentUserId } from "../lib/user-context.js";

export const dailyRouter = Router();
dailyRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

dailyRouter.get(
  "/daily-quiz/archive",
  asyncHandler(async (req, res) => {
    const { page, paper } = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        // Optional GS/CSAT segmentation. Not validated against the exam's paper
        // list here: the query it feeds is already scoped by exam_code, so an
        // unknown or foreign code narrows to zero rows rather than leaking
        // another exam's quizzes.
        paper: z.string().min(1).max(64).optional(),
      }),
      req.query,
    );
    const { items, total } = await listDailyQuizzes(await getUserExam(currentUserId()), page, paper);
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
    const quizzes = await ensureTodayQuizzes(await getUserExam(currentUserId()));
    res.json(dailyQuizzesTodayResponseSchema.parse({ data: quizzes, error: null }));
  }),
);

dailyRouter.get(
  "/mocks/cutoffs",
  asyncHandler(async (req, res) => {
    // `exam` is a PAPER code despite the name (M12 — the param is public API and
    // its rename is tracked separately). The user's real exam is a second axis,
    // and passing it is what stops a second exam's user from being served
    // UPPSC's cut-offs as their own.
    const { exam } = parse(z.object({ exam: z.string().default("PRE_GS1") }), req.query);
    const cutoffs = await getCutoffs(exam, await getUserExam(currentUserId()));
    res.json(examCutoffsResponseSchema.parse({ data: cutoffs, error: null }));
  }),
);
