/**
 * Sukoon F6 exercise-library data hooks — TanStack Query over the
 * /api/sukoon/exercises endpoints. Mirrors use-sukoon-mood.ts's conventions.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonExercisesResponseSchema,
  sukoonAudioUrlResponseSchema,
  sukoonExerciseSessionResponseSchema,
  type SukoonExerciseAudioLang,
  type SukoonExerciseSessionCompleteBody,
} from "@neev/shared";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Retries a signed-URL fetch only on a transient (5xx/network) failure, up to
 *  2 extra times — a 402/404 (locked, or audio genuinely not uploaded) is a
 *  real, stable answer and retrying it would just delay showing that state. */
function retryOnServerErrorOnly(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  return !(error instanceof ApiError) || error.status >= 500;
}

export function useExercises(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonExercises(),
    queryFn: () => api.get("/api/sukoon/exercises", sukoonExercisesResponseSchema),
    enabled: options?.enabled ?? true,
    // Content changes rarely (operator-seeded) — a longer stale window keeps
    // the tools grid from refetching on every tab focus.
    staleTime: 5 * 60_000,
  });
}

/**
 * Mints (and re-mints, once the 1h TTL nears) a signed URL for one exercise's
 * audio. `enabled` should stay false until the player actually needs the
 * file (e.g. after "start"), so browsing the grid never triggers a sign call.
 */
export function useExerciseAudioUrl(
  exerciseId: string | null,
  lang: SukoonExerciseAudioLang,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.sukoonExerciseAudioUrl(exerciseId ?? "", lang),
    queryFn: () =>
      api.get(`/api/sukoon/exercises/${exerciseId}/audio-url`, sukoonAudioUrlResponseSchema, { lang }),
    enabled: !!exerciseId && (options?.enabled ?? true),
    staleTime: 50 * 60_000,
    retry: retryOnServerErrorOnly,
  });
}

export function useAmbientAudioUrl(id: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonAmbientAudioUrl(id ?? ""),
    queryFn: () =>
      api.get(`/api/sukoon/exercises/ambient/${id}/audio-url`, sukoonAudioUrlResponseSchema),
    enabled: !!id && (options?.enabled ?? true),
    staleTime: 50 * 60_000,
    // Deliberately no retry, unlike useExerciseAudioUrl above — the ambient
    // mixer's whole design is "fall back to a synthesized loop fast" (see
    // use-ambient-channel.ts), and a 404 here almost always just means the
    // real file hasn't been uploaded yet, not a transient failure.
    retry: false,
  });
}

export function useStartExerciseSession() {
  return useMutation({
    mutationFn: (exerciseId: string | null) =>
      api.post("/api/sukoon/exercises/sessions", sukoonExerciseSessionResponseSchema, {
        exercise_id: exerciseId,
      }),
  });
}

export function useCompleteExerciseSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SukoonExerciseSessionCompleteBody }) =>
      api.patch(`/api/sukoon/exercises/sessions/${id}`, sukoonExerciseSessionResponseSchema, body),
    onSuccess: () => {
      // Nothing in the tools grid reads session history today, but keep this
      // consistent with every other Sukoon mutation's invalidate-the-family
      // convention so a future stats surface picks it up for free.
      void queryClient.invalidateQueries({ queryKey: ["sukoon", "exercises"] });
      // A completed session is one of the three activities that grow the
      // Garden (F11) — refresh it so Home reflects it without waiting for an
      // unrelated refocus/remount.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonGarden() });
    },
  });
}
