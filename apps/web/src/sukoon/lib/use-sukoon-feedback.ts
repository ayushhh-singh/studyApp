import { useMutation, useQuery } from "@tanstack/react-query";
import {
  sukoonFeedbackAdminListResponseSchema,
  sukoonFeedbackSubmitResponseSchema,
  type SukoonFeedbackSubmitBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Submit (or re-submit — the server upserts by target) a thumbs/note. */
export function useSubmitSukoonFeedback() {
  return useMutation({
    mutationFn: (body: SukoonFeedbackSubmitBody) =>
      api.post("/api/sukoon/feedback", sukoonFeedbackSubmitResponseSchema, body),
  });
}

/** Admin-only paginated feedback list (see routes/admin.ts's is_admin gate). */
export function useAdminSukoonFeedback(page: number, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonAdminFeedback(page),
    queryFn: () =>
      api.get("/api/sukoon/admin/feedback", sukoonFeedbackAdminListResponseSchema, { page, page_size: 30 }),
    enabled: options?.enabled ?? true,
  });
}
