import { useMutation, useQuery } from "@tanstack/react-query";
import { reportActionResponseSchema, reportsQueueResponseSchema, type ReportAction, type ReportTargetType } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useReviewReports(page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminReports(page),
    queryFn: () => api.get("/api/v1/admin/community/reports", reportsQueueResponseSchema, { page }),
    enabled,
  });
}

export function useResolveReport() {
  return useMutation({
    mutationFn: ({
      targetType,
      targetId,
      action,
    }: {
      targetType: ReportTargetType;
      targetId: string;
      action: ReportAction;
    }) =>
      api.post(`/api/v1/admin/community/reports/${targetType}/${targetId}/resolve`, reportActionResponseSchema, {
        action,
      }),
  });
}
