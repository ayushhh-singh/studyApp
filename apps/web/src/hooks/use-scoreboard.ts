import { useQuery } from "@tanstack/react-query";
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
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useDailyQuizTodayBoard() {
  return useQuery({
    queryKey: queryKeys.scoreboardDailyToday(),
    queryFn: () => api.get("/api/v1/scoreboard/prelims/daily-quiz/today", dailyQuizTodayResponseSchema),
  });
}

export function useDailyQuizWeeklyBoard() {
  return useQuery({
    queryKey: queryKeys.scoreboardDailyWeekly(),
    queryFn: () => api.get("/api/v1/scoreboard/prelims/daily-quiz/weekly", dailyQuizWeeklyResponseSchema),
  });
}

export function useScoreboardMockTests(paperCode?: string) {
  return useQuery({
    queryKey: queryKeys.scoreboardMockTests(paperCode),
    queryFn: () =>
      api.get("/api/v1/scoreboard/prelims/mocks/tests", scoreboardTestListResponseSchema, {
        paper_code: paperCode,
      }),
  });
}

export function useMockSeriesBoard(paperCode: string) {
  return useQuery({
    queryKey: queryKeys.scoreboardMockSeries(paperCode),
    queryFn: () =>
      api.get("/api/v1/scoreboard/prelims/mocks/series", mockSeriesBoardResponseSchema, { paper_code: paperCode }),
    enabled: !!paperCode,
  });
}

export function useScoreboardSectionalTests(paperCode?: string) {
  return useQuery({
    queryKey: queryKeys.scoreboardSectionalTests(paperCode),
    queryFn: () =>
      api.get("/api/v1/scoreboard/prelims/sectionals/tests", scoreboardTestListResponseSchema, {
        paper_code: paperCode,
      }),
  });
}

export function useScoreboardTestBoard(testId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scoreboardTest(testId ?? ""),
    queryFn: () => api.get(`/api/v1/scoreboard/prelims/tests/${testId}`, testBoardResponseSchema),
    enabled: !!testId,
  });
}

export function useMainsWeeklyBoard() {
  return useQuery({
    queryKey: queryKeys.scoreboardMainsWeekly(),
    queryFn: () => api.get("/api/v1/scoreboard/mains/weekly", mainsWeeklyBoardResponseSchema),
  });
}

export function useMainsEssayBoard() {
  return useQuery({
    queryKey: queryKeys.scoreboardMainsEssay(),
    queryFn: () => api.get("/api/v1/scoreboard/mains/essay", mainsWeeklyBoardResponseSchema),
  });
}

export function useDimensionBests() {
  return useQuery({
    queryKey: queryKeys.scoreboardDimensionBests(),
    queryFn: () => api.get("/api/v1/scoreboard/mains/dimension-bests", dimensionBestsResponseSchema),
  });
}

/** Rank card for the moment right after a result — null when not applicable (e.g. a re-attempt). */
export function useAttemptRankCard(attemptId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scoreboardRankCardAttempt(attemptId ?? ""),
    queryFn: () => api.get(`/api/v1/scoreboard/rank-card/attempt/${attemptId}`, rankCardResponseSchema),
    enabled: !!attemptId,
  });
}

/** Private evaluation percentile — withheld (eligible: false) until the qualifying pool >= 30. */
export function useEvaluationPercentile(submissionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scoreboardRankCardEvaluation(submissionId ?? ""),
    queryFn: () =>
      api.get(`/api/v1/scoreboard/rank-card/evaluation/${submissionId}`, evaluationPercentileResponseSchema),
    enabled: !!submissionId,
  });
}

export function useMyRankHistory() {
  return useQuery({
    queryKey: queryKeys.scoreboardMyRanks(),
    queryFn: () => api.get("/api/v1/scoreboard/my-ranks", rankHistoryResponseSchema),
  });
}
