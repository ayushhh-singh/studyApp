/**
 * Wraps the F6 session start/complete lifecycle (blueprint: "exercise session
 * logging endpoint, start/complete, duration") behind a small imperative API
 * every player (breathing/grounding/pmr/timer/meditation) can share.
 */
import { useCallback, useRef } from "react";
import { useStartExerciseSession, useCompleteExerciseSession } from "./use-sukoon-exercises";

export function useExerciseSession(exerciseId: string | null) {
  const startMut = useStartExerciseSession();
  const completeMut = useCompleteExerciseSession();
  // Holds the in-flight start request, not just its eventual id — a caller
  // that finishes very quickly (e.g. tapping through all 5 grounding steps
  // faster than the POST round-trips) must WAIT for it rather than silently
  // dropping the completion, which is what a plain "if no id yet, no-op"
  // guard would do.
  const pendingStartRef = useRef<Promise<string> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    pendingStartRef.current = startMut.mutateAsync(exerciseId).then((res) => res.session.id);
    // A start that fails outright must not wedge a later complete() forever —
    // let the rejection surface there instead of leaving a dangling promise.
    pendingStartRef.current.catch(() => {});
  }, [exerciseId, startMut]);

  /** `durationS` overrides the auto-computed elapsed time when a caller already tracks its own clock. */
  const complete = useCallback(
    (durationS?: number) => {
      const pending = pendingStartRef.current;
      if (!pending) return;
      pendingStartRef.current = null;
      const elapsed = durationS ?? Math.max(0, Math.round((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
      void pending
        .then((id) => completeMut.mutate({ id, body: { duration_s: elapsed, completed: true } }))
        .catch(() => {
          /* start never landed — nothing to mark complete */
        });
    },
    [completeMut],
  );

  return { start, complete };
}
