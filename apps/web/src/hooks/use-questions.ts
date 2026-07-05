import { useQuery } from "@tanstack/react-query";
import { questionResponseSchema, questionsResponseSchema, type QuestionType } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useQuestions(filters?: {
  type?: QuestionType;
  paper?: string;
  node?: string;
  year?: number;
  page?: number;
}) {
  return useQuery({
    queryKey: queryKeys.questions(filters),
    queryFn: () => api.get("/api/v1/questions", questionsResponseSchema, filters),
  });
}

export function useQuestion(questionId: string | undefined) {
  return useQuery({
    queryKey: ["questions", "detail", questionId ?? ""],
    queryFn: () => api.get(`/api/v1/questions/${questionId}`, questionResponseSchema),
    enabled: !!questionId,
  });
}
