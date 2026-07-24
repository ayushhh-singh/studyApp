/**
 * Sukoon F7 — Guided Journeys data hooks — TanStack Query over the
 * /api/sukoon/journeys endpoints. Mirrors use-sukoon-exercises.ts's conventions.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonJourneysResponseSchema,
  sukoonJourneyDetailResponseSchema,
  sukoonJourneyProgressResponseSchema,
  sukoonJourneyTodayResponseSchema,
  type SukoonJourneyCompleteStepBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** GET /journeys — the catalog. Content changes rarely (admin-authored),
 *  but progress changes every time a step completes, so a short stale window. */
export function useJourneys(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJourneys(),
    queryFn: () => api.get("/api/sukoon/journeys", sukoonJourneysResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useJourneyDetail(slug: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJourneyDetail(slug ?? ""),
    queryFn: () => api.get(`/api/sukoon/journeys/${slug}`, sukoonJourneyDetailResponseSchema),
    enabled: !!slug && (options?.enabled ?? true),
  });
}

/** GET /journeys/:slug/today — the day player's one read; refetch on window
 *  focus so a day-lock countdown that expired while the tab was backgrounded
 *  resolves to the fresh "step" state without a manual reload. */
export function useJourneyToday(slug: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJourneyToday(slug ?? ""),
    queryFn: () => api.get(`/api/sukoon/journeys/${slug}/today`, sukoonJourneyTodayResponseSchema),
    enabled: !!slug && (options?.enabled ?? true),
    refetchOnWindowFocus: true,
  });
}

function invalidateJourneyFamily(queryClient: ReturnType<typeof useQueryClient>, slug: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneys() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneyDetail(slug) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneyToday(slug) });
}

/** POST /journeys/:slug/start — idempotent while in progress; resets in place
 *  (blueprint: "re-take anytime") when the prior run already finished. */
export function useStartJourney() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      api.post(`/api/sukoon/journeys/${slug}/start`, sukoonJourneyProgressResponseSchema),
    onSuccess: (_data, slug) => invalidateJourneyFamily(queryClient, slug),
  });
}

/** POST /journeys/:slug/steps/:stepId/complete — writes the fresh "today"
 *  state straight into cache (no refetch round-trip needed for the day
 *  player's next render) and invalidates the catalog so its progress ring
 *  picks up the change next time it's visible. */
export function useCompleteJourneyStep(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stepId, body }: { stepId: string; body?: SukoonJourneyCompleteStepBody }) =>
      api.post(
        `/api/sukoon/journeys/${slug}/steps/${stepId}/complete`,
        sukoonJourneyTodayResponseSchema,
        body ?? {},
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.sukoonJourneyToday(slug), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneys() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneyDetail(slug) });
    },
  });
}

export function useSaveJourneyReflection(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reflection: string) =>
      api.post(`/api/sukoon/journeys/${slug}/reflection`, sukoonJourneyProgressResponseSchema, { reflection }),
    onSuccess: () => invalidateJourneyFamily(queryClient, slug),
  });
}
