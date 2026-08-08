import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyQuizArchiveResponseSchema, dailyQuizzesTodayResponseSchema, type DailyQuizzesToday } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The daily-quiz archive (today, yesterday's makeup, and every past day), newest first. */
/**
 * `paper` narrows the archive to one paper (GS/CSAT segmentation) and is applied
 * SERVER-SIDE — see listDailyQuizzes for why filtering a fetched page would
 * produce ragged pages. It is part of the query key, so the mixed and per-paper
 * archives are separate cache entries rather than one that flip-flops.
 */
export function useDailyQuizArchive(page = 1, paper?: string) {
  return useQuery({
    queryKey: queryKeys.dailyQuizArchive(page, paper),
    queryFn: () =>
      api.get("/api/v1/daily-quiz/archive", dailyQuizArchiveResponseSchema, paper ? { page, paper } : { page }),
  });
}

/**
 * Self-heal: ensure BOTH of today's daily quizzes (GS + CSAT) exist (in case the
 * 5:00 AM IST generation cron hasn't run yet — the common case in dev, and
 * possible in prod if a run is ever missed/delayed) and return their summaries.
 * Lets both the dashboard's Today card and the Practice > Daily Quiz panel
 * recover from a missing "today" entry with one tap instead of a dead end.
 * A variant resolves to `null` if it has genuinely no published questions yet.
 */
export function useEnsureTodayQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<DailyQuizzesToday> => api.post("/api/v1/daily-quiz/today", dailyQuizzesTodayResponseSchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-quiz", "archive"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary() });
    },
  });
}
