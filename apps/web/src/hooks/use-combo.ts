import { useCallback, useState } from "react";

/**
 * Consecutive-correct combo tracker for instant-feedback modes (Time Attack,
 * Ghost Battle). A miss resets the count to zero SILENTLY — no penalty, no
 * mockery, just back to building. Tracks the run's best for the end screen.
 */
export function useCombo() {
  const [combo, setCombo] = useState(0);
  const [best, setBest] = useState(0);

  const register = useCallback((correct: boolean) => {
    setCombo((prev) => {
      const next = correct ? prev + 1 : 0;
      setBest((b) => Math.max(b, next));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setCombo(0);
    setBest(0);
  }, []);

  return { combo, best, register, reset };
}
