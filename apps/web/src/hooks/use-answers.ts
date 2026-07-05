import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  submissionDetailResponseSchema,
  submissionListResponseSchema,
  submissionResponseSchema,
  todaysQuestionResponseSchema,
  type CreateSubmissionBody,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useTodaysQuestion() {
  return useQuery({
    queryKey: queryKeys.todaysQuestion(),
    queryFn: () => api.get("/api/v1/answers/today", todaysQuestionResponseSchema),
  });
}

export function useSubmissions(page = 1) {
  return useQuery({
    queryKey: queryKeys.submissions(page),
    queryFn: () => api.get("/api/v1/answers/submissions", submissionListResponseSchema, { page }),
  });
}

export function useSubmissionDetail(submissionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.submissionDetail(submissionId ?? ""),
    queryFn: () => api.get(`/api/v1/answers/submissions/${submissionId}`, submissionDetailResponseSchema),
    enabled: !!submissionId,
  });
}

export function useCreateSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubmissionBody) =>
      api.post("/api/v1/answers/submissions", submissionResponseSchema, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["answers", "submissions"] });
    },
  });
}

/** Trust-loop confirm step: persists the user's reviewed/edited OCR transcription. */
export function useConfirmOcr(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api.patch(`/api/v1/answers/submissions/${submissionId}/confirm-ocr`, submissionResponseSchema, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.submissionDetail(submissionId) });
    },
  });
}
