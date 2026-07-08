import { useQuery } from "@tanstack/react-query";
import { profileAnalyticsResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The `/:locale/profile` analytics bundle — one aggregate call for the whole page. */
export function useProfileAnalytics() {
  return useQuery({
    queryKey: queryKeys.profileAnalytics(),
    queryFn: () => api.get("/api/v1/profile/analytics", profileAnalyticsResponseSchema),
  });
}
