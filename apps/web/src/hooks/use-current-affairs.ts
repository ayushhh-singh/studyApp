import { useMutation, useQuery } from "@tanstack/react-query";
import {
  currentAffairsItemResponseSchema,
  currentAffairsQuizResponseSchema,
  currentAffairsResponseSchema,
  type CurrentAffairsCategory,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCurrentAffairs(filters?: {
  date?: string;
  category?: CurrentAffairsCategory;
  up_only?: boolean;
  page?: number;
}) {
  return useQuery({
    queryKey: queryKeys.currentAffairs(filters),
    queryFn: () => api.get("/api/v1/current-affairs", currentAffairsResponseSchema, filters),
  });
}

export function useCurrentAffairsItem(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.currentAffairsItem(id ?? ""),
    queryFn: () => api.get(`/api/v1/current-affairs/${id}`, currentAffairsItemResponseSchema),
    enabled: !!id,
  });
}

export function useCurrentAffairsQuiz() {
  return useMutation({
    mutationFn: (days: number) =>
      api.post("/api/v1/current-affairs/quiz", currentAffairsQuizResponseSchema, { days }),
  });
}
