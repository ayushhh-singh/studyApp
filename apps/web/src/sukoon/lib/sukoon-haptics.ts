/**
 * Sukoon haptics — a thin, honest wrapper over the Web Vibration API, used to
 * give breathing exercises a gentle physical pulse on each phase change (a
 * Headspace-style signature: your wrist, not just your eyes, paces the breath).
 *
 * PLATFORM REALITY — read before assuming this "works":
 *   • Android Chrome / Firefox / Samsung Internet, and installed Android PWAs:
 *     fully supported. This is the majority of our user base (budget Android),
 *     so the feature genuinely lands for most people.
 *   • iOS (Safari AND every other iOS browser, since all use WebKit) does NOT
 *     implement navigator.vibrate at all — it is a permanent, silent no-op on
 *     iPhone/iPad. Apple exposes haptics only to native apps (and, narrowly, to
 *     a <label>/switch tap), never to arbitrary web JS. There is no PWA
 *     workaround today. We do NOT fake it or fall back to sound.
 *   • Desktop browsers: the API often exists but most machines have no vibration
 *     motor, so calls are accepted and do nothing.
 *
 * Because support is genuinely partial, haptics are treated as an ENHANCEMENT,
 * never load-bearing: the visual breathing circle and the countdown always
 * carry the pacing on their own. `hapticsSupported()` lets the UI hide a
 * haptics toggle on platforms (iOS/desktop) where it could never do anything,
 * rather than offering a switch that silently lies.
 */

export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    // A vibration motor is device-, not just API-gated; `hardwareConcurrency`
    // can't tell us, so we still gate the UI toggle on the API's presence and
    // accept that a motor-less desktop is a harmless no-op.
    "vibrate" in navigator
  );
}

/**
 * Fire a pattern. Never throws (some engines reject odd-length or too-long
 * patterns), never runs when unsupported. A falsy/zero pattern is a no-op.
 */
export function vibrate(pattern: number | number[]): void {
  if (!hapticsSupported()) return;
  if (typeof pattern === "number" ? pattern <= 0 : pattern.length === 0) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* engine rejected the pattern — haptics are non-essential, swallow it */
  }
}

/** Cancel any in-flight vibration (call on pause/stop/unmount). */
export function stopVibration(): void {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    /* no-op */
  }
}

/**
 * Distinct textures per breath phase so the body can tell them apart without
 * looking — a rising double-tap to draw breath IN, one long soft buzz to let
 * it OUT, a single light tick to mark a hold. Deliberately gentle (short,
 * low-count) — this should feel like a nudge, not an alarm. A phase whose
 * exercise config carries its own `haptics_pattern_ms` overrides these.
 */
export const BREATH_HAPTICS: Record<string, number | number[]> = {
  inhale: [0, 45, 40, 70], // two taps, second longer — a gentle "draw in"
  hold: 25, // one light tick
  exhale: [0, 160], // a single long, soft release
  hold_empty: 25,
};

export function breathHapticFor(phaseId: string, configured?: number): number | number[] {
  // A real, positive configured value wins; otherwise fall back to the
  // phase-typed default (and if the phase id is unknown, a soft single tick).
  if (typeof configured === "number" && configured > 0) return configured;
  return BREATH_HAPTICS[phaseId] ?? 30;
}
