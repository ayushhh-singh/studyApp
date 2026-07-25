/**
 * Personalized guided-meditation data hooks — TanStack Query over the
 * /api/sukoon/meditation endpoints. Mirrors use-sukoon-exercises.ts's conventions.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonMeditationContextResponseSchema,
  sukoonMeditationDetailResponseSchema,
  sukoonMeditationListResponseSchema,
  sukoonMeditationResponseSchema,
  sukoonMeditationUsageResponseSchema,
  type SukoonMeditationGenerateBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The setup screen's smart defaults (suggested focus + gentle theme label). */
export function useMeditationContext(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMeditationContext(),
    queryFn: () => api.get("/api/sukoon/meditation/context", sukoonMeditationContextResponseSchema),
    enabled: options?.enabled ?? true,
    // A fresh signal each visit matters (the mood/chat may have just changed),
    // so keep this short-lived rather than cached across the session.
    staleTime: 15_000,
  });
}

/** The generation allowance meter (for the "N left" copy + gating the button). */
export function useMeditationUsage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMeditationUsage(),
    queryFn: () => api.get("/api/sukoon/meditation/usage", sukoonMeditationUsageResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/** Recent meditations (a small "again" list). */
export function useMeditationList(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMeditationList(),
    queryFn: () => api.get("/api/sukoon/meditation", sukoonMeditationListResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/** Replay one saved meditation (re-signs a fresh audio URL). */
export function useMeditationDetail(id: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMeditationDetail(id ?? ""),
    queryFn: () => api.get(`/api/sukoon/meditation/${id}`, sukoonMeditationDetailResponseSchema),
    enabled: !!id && (options?.enabled ?? true),
    // A signed URL lasts ~1h; re-fetch a little before it lapses if still open.
    staleTime: 50 * 60_000,
  });
}

/** Generate (or replay a cached) personalized meditation. */
export function useGenerateMeditation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SukoonMeditationGenerateBody) =>
      api.post("/api/sukoon/meditation/generate", sukoonMeditationResponseSchema, body),
    onSuccess: () => {
      // A real generation consumes an allowance credit; refresh the meter + list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonMeditationUsage() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonMeditationList() });
    },
  });
}
