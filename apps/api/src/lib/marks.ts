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

/**
 * Fallback marks for an MCQ whose own `marks` is somehow null. Every question
 * SHOULD carry real marks (UPPSC GS-I 1.33/q, CSAT & generated & CA 2/q), so
 * this is a safety net, not a normal path — but it must be NON-ZERO: a 0-mark
 * MCQ is a dead question (a correct answer earns nothing, a wrong one is never
 * penalized). Matches mocks' existing default. A daily-quiz pool that defaulted
 * a missing mark to 0 (rather than this) is exactly what froze 8 dead questions
 * into an old quiz and scored it 25.3/-0.77.
 */
export const DEFAULT_MCQ_MARKS = 2;
