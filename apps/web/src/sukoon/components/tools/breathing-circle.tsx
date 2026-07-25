/** The breathing exercise's SVG circle — scales up on inhale, down on
 *  exhale, holds steady on a hold phase, animated via a CSS transition whose
 *  duration matches the phase's own seconds (so the motion IS the pacing). */
export function BreathingCircle({
  targetScale,
  seconds,
  label,
  seconds_remaining,
}: {
  targetScale: number;
  seconds: number;
  label: string;
  seconds_remaining: number;
}) {
  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-72 items-center justify-center">
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full text-secondary/25" aria-hidden>
        <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" />
      </svg>
      <div
        className="flex aspect-square w-3/4 items-center justify-center rounded-full bg-secondary/20 text-center"
        style={{
          transform: `scale(${targetScale})`,
          transitionProperty: "transform",
          transitionDuration: `${Math.max(seconds, 0.1)}s`,
          transitionTimingFunction: "ease-in-out",
        }}
      >
        <div className="flex flex-col items-center gap-1">
          {/* aria-live on the PHASE label only (inhale/hold/exhale — changes a
              few times per cycle) — the countdown number is deliberately
              outside any live region, same convention as the test-player's
              countdown timer, so per-second ticks don't spam a screen reader. */}
          <span aria-live="polite" className="text-base font-semibold text-secondary">
            {label}
          </span>
          <span className="text-2xl font-bold tabular-nums text-secondary">{seconds_remaining}</span>
        </div>
      </div>
    </div>
  );
}
