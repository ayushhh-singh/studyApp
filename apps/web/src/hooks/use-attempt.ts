import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  attemptDetailResponseSchema,
  attemptResponseSchema,
  attemptResultResponseSchema,
  attemptSubmitResponseSchema,
  type AttemptStartBody,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useStartAttempt() {
  return useMutation({
    mutationFn: (body: AttemptStartBody) => api.post("/api/v1/attempts", attemptResponseSchema, body),
  });
}

export function useAttemptDetail(attemptId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.attempt(attemptId ?? ""),
    queryFn: () => api.get(`/api/v1/attempts/${attemptId}`, attemptDetailResponseSchema),
    enabled: !!attemptId,
  });
}

export function useAttemptResult(attemptId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.attemptResult(attemptId ?? ""),
    queryFn: () => api.get(`/api/v1/attempts/${attemptId}/result`, attemptResultResponseSchema),
    enabled: !!attemptId,
  });
}

export function useSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) =>
      api.post(`/api/v1/attempts/${attemptId}/submit`, attemptSubmitResponseSchema),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attempt(result.attempt.id) });
      queryClient.invalidateQueries({ queryKey: ["tests"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary() });
    },
  });
}
