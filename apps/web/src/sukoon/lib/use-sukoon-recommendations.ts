/**
 * Sukoon "For you" recommendations hook — TanStack Query over
 * GET /api/sukoon/recommendations. Mirrors use-sukoon-exercises.ts's conventions.
 *
 * Cached a little longer than per-second surfaces (the rolling signal is a
 * cross-day trend, not live state) and invalidated by a new mood check-in — the
 * mood mutations already invalidate the whole ["sukoon","mood"] family, so we
 * also react to that here by keying off a modest staleTime rather than a manual
 * subscription.
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
