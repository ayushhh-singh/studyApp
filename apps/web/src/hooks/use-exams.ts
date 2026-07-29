import { useQuery } from "@tanstack/react-query";
import { examsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * The exam registry — display names, `is_live`, launch scope, and the verified
 * `paper_structure` every exam-pattern number in the UI is read from.
 *
 * `GET /exams` is mounted before requireAuth, so this is safe to call from a
 * signed-out or guest surface as well as inside the app shell.
 *
 * staleTime = 24h, not `Infinity`: the registry lives in a DB table, not the
 * bundle, so it can change WITHOUT a web deploy — flipping `exams.is_live` for a
 * newly-ingested exam is a one-row update. `Infinity` would pin an open tab to
 * the registry it happened to load with until the user reloaded. A day is far
 * longer than any session (so in practice it fetches once) while still bounding
 * how stale a long-lived tab can get. The data is also small and identical for
 * every user, so the occasional refetch costs nothing.
 */
export function useExams() {
  return useQuery({
    queryKey: queryKeys.exams(),
    queryFn: () => api.get("/api/v1/exams", examsResponseSchema),
    staleTime: 24 * 60 * 60_000,
  });
}
