import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSrsCardsResponseSchema,
  seedRevisionResponseSchema,
  srsCardResponseSchema,
  srsDueQueueResponseSchema,
  srsStatsResponseSchema,
  type BilingualText,
  type SrsSourceType,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSrsDueQueue(limit?: number) {
  return useQuery({
    queryKey: queryKeys.srsDue(limit),
    queryFn: () => api.get("/api/v1/srs/due", srsDueQueueResponseSchema, limit ? { limit } : undefined),
  });
}

export function useSrsStats(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.srsStats(),
    queryFn: () => api.get("/api/v1/srs/stats", srsStatsResponseSchema),
    enabled: opts?.enabled,
  });
}

export function useSrsCards(filters: { query?: string; sourceType?: SrsSourceType; page?: number }) {
  return useQuery({
    queryKey: queryKeys.srsCards(filters),
    queryFn: () =>
      api.get("/api/v1/srs/cards", listSrsCardsResponseSchema, {
        query: filters.query || undefined,
        source_type: filters.sourceType,
        page: filters.page,
      }),
    placeholderData: (prev) => prev,
  });
}

export function useInvalidateSrs() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["srs"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary() });
  };
}

export function useCreateSrsCard() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (body: { front_i18n: BilingualText; back_i18n: BilingualText }) =>
      api.post("/api/v1/srs/cards", srsCardResponseSchema, body),
    onSuccess: invalidate,
  });
}

export function useUpdateSrsCard() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; front_i18n?: BilingualText; back_i18n?: BilingualText }) =>
      api.patch(`/api/v1/srs/cards/${id}`, srsCardResponseSchema, body),
    onSuccess: invalidate,
  });
}

export function useDeleteSrsCard() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/srs/cards/${id}`),
    onSuccess: invalidate,
  });
}

export function useSeedWrongAnswers() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: () => api.post("/api/v1/srs/seed/wrong-answers", seedRevisionResponseSchema),
    onSuccess: invalidate,
  });
}

export function useSeedNoteFacts() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: () => api.post("/api/v1/srs/seed/note-facts", seedRevisionResponseSchema),
    onSuccess: invalidate,
  });
}
