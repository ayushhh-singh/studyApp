import { useMutation, useQuery } from "@tanstack/react-query";
import {
  reviewNoteActionResponseSchema,
  reviewNotesResponseSchema,
  type ReviewNoteEditBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useReviewNotes(page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reviewNotes(page),
    queryFn: () => api.get("/api/v1/admin/notes/review", reviewNotesResponseSchema, { page }),
    enabled,
  });
}

export function useNoteApprove() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/notes/${id}/approve`, reviewNoteActionResponseSchema),
  });
}

export function useNoteReject() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/api/v1/admin/notes/${id}/reject`, reviewNoteActionResponseSchema, { reason }),
  });
}

export function useNoteEdit() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewNoteEditBody }) =>
      api.patch(`/api/v1/admin/notes/${id}`, reviewNoteActionResponseSchema, body),
  });
}
