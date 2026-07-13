import { useMutation, useQuery } from "@tanstack/react-query";
import {
  questionReportActionResponseSchema,
  questionReportResultResponseSchema,
  questionReportsQueueResponseSchema,
  type CreateQuestionReportBody,
  type QuestionReportAction,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** User-facing "Report this question" submit. */
export function useReportQuestion() {
  return useMutation({
    mutationFn: ({ questionId, body }: { questionId: string; body: CreateQuestionReportBody }) =>
      api.post(`/api/v1/questions/${questionId}/reports`, questionReportResultResponseSchema, body),
  });
}

/** Admin: the "Reported questions" review-queue tab. */
export function useQuestionReportsQueue(page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminQuestionReports(page),
    queryFn: () => api.get("/api/v1/admin/question-reports", questionReportsQueueResponseSchema, { page }),
    enabled,
  });
}

/** Admin: resolve a reported question (fix key / regenerate explanation / unpublish / dismiss). */
export function useResolveQuestionReport() {
  return useMutation({
    mutationFn: ({
      questionId,
      action,
      correctKey,
    }: {
      questionId: string;
      action: QuestionReportAction;
      correctKey?: string;
    }) =>
      api.post(`/api/v1/admin/question-reports/${questionId}/resolve`, questionReportActionResponseSchema, {
        action,
        correct_option_key: correctKey,
      }),
  });
}
