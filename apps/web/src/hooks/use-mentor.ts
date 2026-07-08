import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  doubtMessageResponseSchema,
  doubtThreadDetailResponseSchema,
  doubtThreadListResponseSchema,
  doubtThreadResponseSchema,
  mentorInsightResponseSchema,
  mentorInsightsResponseSchema,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useDoubtThreads() {
  return useQuery({
    queryKey: queryKeys.doubtThreads(),
    queryFn: () => api.get("/api/v1/doubts/threads", doubtThreadListResponseSchema),
  });
}

export function useDoubtThread(threadId: string | null) {
  return useQuery({
    queryKey: threadId ? queryKeys.doubtThread(threadId) : ["doubts", "threads", "none"],
    queryFn: () => api.get(`/api/v1/doubts/threads/${threadId}`, doubtThreadDetailResponseSchema),
    enabled: !!threadId,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.post("/api/v1/doubts/threads", doubtThreadResponseSchema, title ? { title } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.doubtThreads() }),
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/doubts/threads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.doubtThreads() }),
  });
}

export function useQuizMe(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/v1/doubts/threads/${threadId}/quiz`, doubtMessageResponseSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.doubtThread(threadId) }),
  });
}

export function useMentorInsights() {
  return useQuery({
    queryKey: queryKeys.mentorInsights(),
    queryFn: () => api.get("/api/v1/mentor/insights", mentorInsightsResponseSchema),
  });
}

export function useDismissInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/mentor/insights/${id}/dismiss`, mentorInsightResponseSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.mentorInsights() }),
  });
}
