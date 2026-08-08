import { useMutation, useQuery } from "@tanstack/react-query";
import {
  currentAffairsItemResponseSchema,
  currentAffairsQuizResponseSchema,
  currentAffairsResponseSchema,
  currentAffairsDailySetsResponseSchema,
  currentAffairsWeeklySetsResponseSchema,
  type CurrentAffairsCategory,
  type CurrentAffairsLens,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCurrentAffairs(filters?: {
  date?: string;
  category?: CurrentAffairsCategory;
  lens?: CurrentAffairsLens;
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

/** The week's curated sitting (up to 20 CA MCQs + 5 descriptive), built Monday. */
export function useWeeklyCaSets() {
  return useQuery({
    queryKey: queryKeys.currentAffairsWeeklySets(),
    queryFn: () => api.get("/api/v1/current-affairs/weekly-sets", currentAffairsWeeklySetsResponseSchema),
  });
}

/**
 * Today's quick sitting (up to 5 CA MCQs + 2 descriptive) over what was approved
 * since yesterday. Separate from the weekly query because the two are built by
 * different crons — either can be present while the other is null.
 */
export function useDailyCaSets() {
  return useQuery({
    queryKey: queryKeys.currentAffairsDailySets(),
    queryFn: () => api.get("/api/v1/current-affairs/daily-sets", currentAffairsDailySetsResponseSchema),
  });
}

export function useCurrentAffairsQuiz() {
  return useMutation({
    mutationFn: (days: number) =>
      api.post("/api/v1/current-affairs/quiz", currentAffairsQuizResponseSchema, { days }),
  });
}
