import { useMutation, useQuery } from "@tanstack/react-query";
import {
  currentAffairsItemResponseSchema,
  currentAffairsQuizResponseSchema,
  currentAffairsResponseSchema,
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

/** The two ready-to-run weekly assemblies (CA Prelims Quiz + CA Mains Set). */
export function useWeeklyCaSets() {
  return useQuery({
    queryKey: queryKeys.currentAffairsWeeklySets(),
    queryFn: () => api.get("/api/v1/current-affairs/weekly-sets", currentAffairsWeeklySetsResponseSchema),
  });
}

export function useCurrentAffairsQuiz() {
  return useMutation({
    mutationFn: (days: number) =>
      api.post("/api/v1/current-affairs/quiz", currentAffairsQuizResponseSchema, { days }),
  });
}
