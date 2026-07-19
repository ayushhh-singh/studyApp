import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminStatusResponseSchema,
  caHighConfidenceCountResponseSchema,
  reviewActionResponseSchema,
  reviewCountsResponseSchema,
  reviewQueueResponseSchema,
  type ReviewEditBody,
  type ReviewTab,
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

export function useReviewCounts(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewCounts(),
    queryFn: () => api.get("/api/v1/admin/review/counts", reviewCountsResponseSchema),
    enabled,
  });
}

export function useReviewQueue(tab: ReviewTab, page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewQueue(tab, page),
    queryFn: () => api.get("/api/v1/admin/review", reviewQueueResponseSchema, { tab, page }),
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

/** How many CA questions across the WHOLE needs_review backlog (not just the current page) are currently high-confidence. */
export function useCaHighConfidenceCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.caHighConfidenceCount(),
    queryFn: () => api.get("/api/v1/admin/review/current-affairs/high-confidence-count", caHighConfidenceCountResponseSchema),
    enabled,
  });
}

/** Approve every high-confidence CA question across the whole backlog in one action. */
export function useCaBulkApproveHighConfidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/v1/admin/review/current-affairs/bulk-approve-high-confidence", reviewActionResponseSchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.caHighConfidenceCount() });
    },
  });
}
