import { useQuery } from "@tanstack/react-query";
import {
  questionResponseSchema,
  questionsResponseSchema,
  type ExamCode,
  type Question,
  type QuestionType,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useQuestions(filters?: {
  type?: QuestionType;
  paper?: string;
  node?: string;
  year?: number;
  exam?: ExamCode;
  page?: number;
}) {
  return useQuery({
    queryKey: queryKeys.questions(filters),
    queryFn: () => api.get("/api/v1/questions", questionsResponseSchema, filters),
    staleTime: 5 * 60_000,
  });
}

export function useQuestion(questionId: string | undefined) {
  return useQuery({
    queryKey: ["questions", "detail", questionId ?? ""],
    queryFn: () => api.get(`/api/v1/questions/${questionId}`, questionResponseSchema),
    enabled: !!questionId,
    staleTime: 5 * 60_000,
  });
}

type QuestionFilters = {
  type?: QuestionType;
  paper?: string;
  node?: string;
  year?: number;
  exam?: ExamCode;
};

/**
 * Fetches every page for a filter set and concatenates them into one flat
 * list — for callers (the Answers PYQ picker) that want to group a paper's
 * full PYQ set by year client-side instead of driving a page-by-page UI.
 * Safe because each Mains paper tops out at a few hundred questions across
 * its ~8 covered exam years — a handful of page fetches, not an unbounded scan.
 */
export function useAllQuestions(filters: QuestionFilters) {
  const enabled = !!(filters.paper || filters.node);
  return useQuery({
    queryKey: queryKeys.questionsAll(filters),
    queryFn: async (): Promise<{ items: Question[]; total: number }> => {
      const first = await api.get("/api/v1/questions", questionsResponseSchema, { ...filters, page: 1 });
      const totalPages = first.pagination.total_pages;
      if (totalPages <= 1) return { items: first.items, total: first.pagination.total };
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          api.get("/api/v1/questions", questionsResponseSchema, { ...filters, page: i + 2 }),
        ),
      );
      return { items: [first.items, ...rest.map((r) => r.items)].flat(), total: first.pagination.total };
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
