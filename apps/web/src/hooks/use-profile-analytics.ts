import { useQuery } from "@tanstack/react-query";
import { profileAnalyticsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The `/:locale/profile` analytics bundle — one aggregate call for the whole page. */
export function useProfileAnalytics(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.profileAnalytics(),
    queryFn: () => api.get("/api/v1/profile/analytics", profileAnalyticsResponseSchema),
    enabled: options?.enabled ?? true,
  });
}
