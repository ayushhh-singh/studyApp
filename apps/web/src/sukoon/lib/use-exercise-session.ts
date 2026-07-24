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
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    startMut.mutate(exerciseId, {
      onSuccess: (res) => {
        sessionIdRef.current = res.session.id;
      },
    });
  }, [exerciseId, startMut]);

  /** `durationS` overrides the auto-computed elapsed time when a caller already tracks its own clock. */
  const complete = useCallback(
    (durationS?: number) => {
      const id = sessionIdRef.current;
      if (!id) return;
      const elapsed = durationS ?? Math.max(0, Math.round((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
      completeMut.mutate({ id, body: { duration_s: elapsed, completed: true } });
      sessionIdRef.current = null;
    },
    [completeMut],
  );

  return { start, complete };
}
