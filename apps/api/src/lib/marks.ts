/**
 * Round a SUMMED marks total to 2 decimal places. UPPSC's fractional
 * per-question marks (e.g. 1.33) sum with IEEE-754 floating-point noise —
 * 150 × 1.33 lands at 199.50000000000054, not 199.5 — which is ugly in the DB
 * and in any raw API consumer, and only happens to look clean because the web
 * display layer rounds it. Round at the point a test's total is persisted so
 * the stored value is honest. 2dp is finer than any real marking scheme's
 * granularity, so this never drops meaningful precision.
 */
export function roundMarks(n: number): number {
  return Math.round(n * 100) / 100;
}
