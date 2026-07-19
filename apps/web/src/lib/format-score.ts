/**
 * UPPSC's one-third negative marking produces fractional scores/totals (e.g.
 * -0.33 per wrong answer) whose sums carry floating-point noise
 * (40.61999999999999) — round to 2 decimals and let Number->String drop
 * trailing zeros, so a whole number still renders as "40" and a fractional
 * one as "40.62" rather than a raw float.
 */
export function formatScoreValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}
