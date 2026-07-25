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
  sukoonMoodPatternResponseSchema,
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

/**
 * The proactive mood-pattern bridge (F5×F6) — a conservative decline read that
 * powers the gentle nudge card. `.data.tier` is "none" unless a genuine trend
 * is found. Cached a little longer than the per-second surfaces since it's a
 * cross-day trend, not live state, and invalidated by a new check-in (the mood
 * mutations already invalidate the whole ["sukoon","mood"] family).
 */
export function useMoodPattern(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodPattern(),
    queryFn: () => api.get("/api/sukoon/mood/pattern", sukoonMoodPatternResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useMoodHeatmap(month: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodHeatmap(month),
    queryFn: () => api.get("/api/sukoon/mood/heatmap", sukoonMoodHeatmapResponseSchema, { month }),
    enabled: options?.enabled ?? true,
  });
}

/** Invalidate everything a create/update/delete can change (today, aggregates,
 *  heatmap) — plus the Garden (F11), since a check-in is one of the three
 *  activities that grow it, so the Home card should reflect it right away
 *  rather than waiting for an unrelated refocus/remount to refetch it. */
function useInvalidateMood() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sukoon", "mood"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonGarden() });
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
