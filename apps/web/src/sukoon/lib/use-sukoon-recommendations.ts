/**
 * Sukoon "For you" recommendations hook — TanStack Query over
 * GET /api/sukoon/recommendations. Mirrors use-sukoon-exercises.ts's conventions.
 *
 * FRESHNESS: the signal is a 21-day rolling window, so a single new check-in
 * barely moves it — a modest staleTime is the right freshness model, not
 * per-mutation invalidation. This query key deliberately sits OUTSIDE the
 * ["sukoon","mood"] family, so a mood mutation does NOT invalidate it; instead
 * it refreshes on the next mount/focus once the staleTime lapses (well within
 * the cross-day cadence this feature reflects). Kept intentionally decoupled so
 * it never needs to reach into the mood/journal mutation hooks.
 */
import { useQuery } from "@tanstack/react-query";
import { sukoonRecommendationsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSukoonRecommendations(limit = 4, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonRecommendations(limit),
    queryFn: () =>
      api.get("/api/sukoon/recommendations", sukoonRecommendationsResponseSchema, {
        limit: String(limit),
      }),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}
