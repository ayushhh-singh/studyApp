import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric value counting up from its previous value (0 on first
 * reveal) to `target` over `durationMs`. Jumps immediately if the user
 * prefers reduced motion.
 */
export function useCountUp(target: number | null, durationMs = 900): number | null {
  const [value, setValue] = useState<number | null>(target);
  const prevTarget = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      prevTarget.current = null;
      return;
    }
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setValue(target);
      prevTarget.current = target;
      return;
    }

    const start = prevTarget.current ?? 0;
    const startTime = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      setValue(start + (target - start) * progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevTarget.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
