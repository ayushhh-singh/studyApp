/**
 * Sukoon F5 mood-tracking data hooks — TanStack Query over the
 * /api/sukoon/mood endpoints. Mirrors use-sukoon-journal.ts's conventions.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonMoodTodayResponseSchema,
  sukoonMoodAggregatesResponseSchema,
  sukoonMoodHeatmapResponseSchema,
  sukoonMoodEntryResponseSchema,
  type SukoonMoodCreateBody,
  type SukoonMoodUpdateBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useMoodToday(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodToday(),
    queryFn: () => api.get("/api/sukoon/mood/today", sukoonMoodTodayResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useMoodAggregates(rangeDays: 7 | 30 | 90, options?: { enabled?: boolean }) {
  const range = String(rangeDays);
  return useQuery({
    queryKey: queryKeys.sukoonMoodAggregates(range),
    queryFn: () =>
      api.get("/api/sukoon/mood/aggregates", sukoonMoodAggregatesResponseSchema, { range }),
    enabled: options?.enabled ?? true,
  });
}

export function useMoodHeatmap(month: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodHeatmap(month),
    queryFn: () => api.get("/api/sukoon/mood/heatmap", sukoonMoodHeatmapResponseSchema, { month }),
    enabled: options?.enabled ?? true,
  });
}

/** Invalidate everything a create/update/delete can change (today, aggregates, heatmap). */
function useInvalidateMood() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sukoon", "mood"] });
  }, [queryClient]);
}

export function useCreateMoodEntry() {
  const invalidate = useInvalidateMood();
  return useMutation({
    mutationFn: (body: SukoonMoodCreateBody) =>
      api.post("/api/sukoon/mood/entries", sukoonMoodEntryResponseSchema, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * `id` is passed per-call (not fixed at hook-creation, unlike the journal
 * editor's pattern) because the check-in screen can switch between editing
 * today's primary entry and an already-saved extra entry in the same session.
 */
export function useUpdateMoodEntry() {
  const invalidate = useInvalidateMood();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SukoonMoodUpdateBody }) =>
      api.patch(`/api/sukoon/mood/entries/${id}`, sukoonMoodEntryResponseSchema, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteMoodEntry() {
  const invalidate = useInvalidateMood();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/sukoon/mood/entries/${id}`),
    onSuccess: () => invalidate(),
  });
}
