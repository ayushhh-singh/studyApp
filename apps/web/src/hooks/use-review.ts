import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminStatusResponseSchema,
  caHighConfidenceCountResponseSchema,
  reviewActionResponseSchema,
  reviewCountsResponseSchema,
  reviewQueueResponseSchema,
  type ReviewEditBody,
  type ReviewTab,
  type TargetExamCode,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Whether the signed-in user is an admin (users_profile.is_admin). Cached hard — a user's admin status doesn't change mid-session. */
export function useAdminStatus() {
  return useQuery({
    queryKey: queryKeys.adminStatus(),
    queryFn: () => api.get("/api/v1/admin/status", adminStatusResponseSchema),
    staleTime: Infinity,
  });
}

/** Per-tab counts, scoped to one exam's backlog (`exam` is required server-side — see reviewCountsQuerySchema). */
export function useReviewCounts(exam: TargetExamCode, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewCounts(exam),
    queryFn: () => api.get("/api/v1/admin/review/counts", reviewCountsResponseSchema, { exam }),
    enabled,
  });
}

export function useReviewQueue(tab: ReviewTab, page: number, exam: TargetExamCode, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewQueue(tab, page, exam),
    queryFn: () => api.get("/api/v1/admin/review", reviewQueueResponseSchema, { tab, page, exam }),
    enabled,
  });
}

export function useReviewApprove() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/review/${id}/approve`, reviewActionResponseSchema),
  });
}

export function useReviewReject() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/api/v1/admin/review/${id}/reject`, reviewActionResponseSchema, { reason }),
  });
}

export function useReviewEdit() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewEditBody }) =>
      api.patch(`/api/v1/admin/review/${id}`, reviewActionResponseSchema, body),
  });
}

export function useReviewBulkApprove() {
  return useMutation({
    mutationFn: (ids: string[]) => api.post("/api/v1/admin/review/bulk-approve", reviewActionResponseSchema, { ids }),
  });
}

/** How many CA questions across the WHOLE needs_review backlog for ONE exam (not just the current page, and never another exam's) are currently high-confidence. */
export function useCaHighConfidenceCount(exam: TargetExamCode, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.caHighConfidenceCount(exam),
    queryFn: () =>
      api.get("/api/v1/admin/review/current-affairs/high-confidence-count", caHighConfidenceCountResponseSchema, { exam }),
    enabled,
  });
}

/** Approve every high-confidence CA question across one exam's whole backlog in one action. */
export function useCaBulkApproveHighConfidence(exam: TargetExamCode) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post("/api/v1/admin/review/current-affairs/bulk-approve-high-confidence", reviewActionResponseSchema, { exam }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.caHighConfidenceCount(exam) });
    },
  });
}
