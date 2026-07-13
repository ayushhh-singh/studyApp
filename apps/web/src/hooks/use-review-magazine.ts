import { useMutation, useQuery } from "@tanstack/react-query";
import {
  reviewMagazineActionResponseSchema,
  reviewMagazineResponseSchema,
  type ReviewMagazineEditBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useReviewMagazine(page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewMagazine(page),
    queryFn: () => api.get("/api/v1/admin/magazine/review", reviewMagazineResponseSchema, { page }),
    enabled,
  });
}

export function useMagazineDeepDiveApprove() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/magazine/${id}/approve`, reviewMagazineActionResponseSchema),
  });
}

export function useMagazineDeepDiveReject() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/api/v1/admin/magazine/${id}/reject`, reviewMagazineActionResponseSchema, { reason }),
  });
}

export function useMagazineDeepDiveEdit() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewMagazineEditBody }) =>
      api.patch(`/api/v1/admin/magazine/${id}`, reviewMagazineActionResponseSchema, body),
  });
}
