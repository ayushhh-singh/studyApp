import { Router } from "express";
import { z } from "zod";
import {
  dailyQuizTodayResponseSchema,
  dailyQuizWeeklyResponseSchema,
  dimensionBestsResponseSchema,
  evaluationPercentileResponseSchema,
  mainsWeeklyBoardResponseSchema,
  mockSeriesBoardResponseSchema,
  rankCardResponseSchema,
  rankHistoryResponseSchema,
  scoreboardTestListResponseSchema,
  testBoardResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { touchFeatureOnRequest } from "../lib/feature-touch.js";
import {
  getDailyQuizTodayBoard,
  getDailyQuizWeeklyBoard,
  getDimensionBests,
  getEvaluationPercentile,
  getMainsEssayWeeklyBoard,
  getMainsWeeklyBoard,
  getMockSeriesBoard,
  getRankCardForAttempt,
  getRankHistory,
  getTestBoard,
  listScoreboardTests,
} from "../services/scoreboard.js";

export const scoreboardRouter = Router();
scoreboardRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));
scoreboardRouter.use(touchFeatureOnRequest("scoreboard"));

scoreboardRouter.get(
  "/scoreboard/prelims/daily-quiz/today",
  asyncHandler(async (_req, res) => {
    const board = await getDailyQuizTodayBoard(currentUserId());
    res.json(dailyQuizTodayResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/prelims/daily-quiz/weekly",
  asyncHandler(async (_req, res) => {
    const board = await getDailyQuizWeeklyBoard(currentUserId());
    res.json(dailyQuizWeeklyResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/prelims/mocks/tests",
  asyncHandler(async (req, res) => {
    const { paper_code } = parse(z.object({ paper_code: z.string().optional() }), req.query);
    const tests = await listScoreboardTests("mock", paper_code);
    res.json(scoreboardTestListResponseSchema.parse({ data: tests, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/prelims/mocks/series",
  asyncHandler(async (req, res) => {
    const { paper_code } = parse(z.object({ paper_code: z.string() }), req.query);
    const board = await getMockSeriesBoard(currentUserId(), paper_code);
    res.json(mockSeriesBoardResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/prelims/sectionals/tests",
  asyncHandler(async (req, res) => {
    const { paper_code } = parse(z.object({ paper_code: z.string().optional() }), req.query);
    const tests = await listScoreboardTests("sectional", paper_code);
    res.json(scoreboardTestListResponseSchema.parse({ data: tests, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/prelims/tests/:testId",
  asyncHandler(async (req, res) => {
    const { testId } = parse(z.object({ testId: z.string().uuid() }), req.params);
    const board = await getTestBoard(currentUserId(), testId);
    res.json(testBoardResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/mains/weekly",
  asyncHandler(async (_req, res) => {
    const board = await getMainsWeeklyBoard(currentUserId());
    res.json(mainsWeeklyBoardResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/mains/essay",
  asyncHandler(async (_req, res) => {
    const board = await getMainsEssayWeeklyBoard(currentUserId());
    res.json(mainsWeeklyBoardResponseSchema.parse({ data: board, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/mains/dimension-bests",
  asyncHandler(async (_req, res) => {
    const data = await getDimensionBests(currentUserId());
    res.json(dimensionBestsResponseSchema.parse({ data, error: null }));
  }),
);

/** Rank card for the moment right after a result — "you ranked N of M today". Null when not applicable. */
scoreboardRouter.get(
  "/scoreboard/rank-card/attempt/:attemptId",
  asyncHandler(async (req, res) => {
    const { attemptId } = parse(z.object({ attemptId: z.string().uuid() }), req.params);
    const card = await getRankCardForAttempt(currentUserId(), attemptId);
    res.json(rankCardResponseSchema.parse({ data: card, error: null }));
  }),
);

/** Private percentile band on the evaluation screen — withheld until the qualifying pool >= 30. */
scoreboardRouter.get(
  "/scoreboard/rank-card/evaluation/:submissionId",
  asyncHandler(async (req, res) => {
    const { submissionId } = parse(z.object({ submissionId: z.string().uuid() }), req.params);
    const percentile = await getEvaluationPercentile(currentUserId(), submissionId);
    res.json(evaluationPercentileResponseSchema.parse({ data: percentile, error: null }));
  }),
);

scoreboardRouter.get(
  "/scoreboard/my-ranks",
  asyncHandler(async (_req, res) => {
    const data = await getRankHistory(currentUserId());
    res.json(rankHistoryResponseSchema.parse({ data, error: null }));
  }),
);
