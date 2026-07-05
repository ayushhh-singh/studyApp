import { useQuery } from "@tanstack/react-query";
import { dashboardSummaryResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboardSummary(),
    queryFn: () => api.get("/api/v1/dashboard/summary", dashboardSummaryResponseSchema),
  });
}
