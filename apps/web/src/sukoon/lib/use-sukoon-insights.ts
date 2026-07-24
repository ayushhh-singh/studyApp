/**
 * Sukoon F9 weekly-insights data hook — read-only over /api/sukoon/insights.
 * Insights are WRITTEN by the Sunday cron, never on demand, so there's no
 * mutation here (a user can't spend a Sonnet call by pressing a button).
 */
import { useQuery } from "@tanstack/react-query";
import { sukoonInsightsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useInsights(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonInsights(),
    queryFn: () => api.get("/api/sukoon/insights", sukoonInsightsResponseSchema),
    enabled: options?.enabled ?? true,
  });
}
