import { useQuery } from "@tanstack/react-query";
import { dailyQuizArchiveResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The daily-quiz archive (today, yesterday's makeup, and every past day), newest first. */
export function useDailyQuizArchive(page = 1) {
  return useQuery({
    queryKey: queryKeys.dailyQuizArchive(page),
    queryFn: () => api.get("/api/v1/daily-quiz/archive", dailyQuizArchiveResponseSchema, { page }),
  });
}
