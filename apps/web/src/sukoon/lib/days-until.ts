const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar day, `YYYY-MM-DD` — mirrors apps/api/src/lib/ist.ts's
 *  istDateString/istToday (that file can't be imported client-side, but the
 *  math is the same few lines). */
function istTodayString(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Whole IST calendar days until a `YYYY-MM-DD` exam date (null when unset);
 * negative if passed. Deliberately computed in the FIXED IST calendar, never
 * the browser's local timezone — "is the exam tomorrow" (blueprint F7's
 * exam-eve surfacing, and the F2 starter-picker) must mean tomorrow-in-India
 * regardless of what timezone the visiting device happens to be set to. Both
 * `to` and `from` are parsed as UTC-midnight-of-that-date-string, so the
 * device's own timezone never enters the calculation at all.
 */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const to = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(to)) return null;
  const from = Date.parse(`${istTodayString()}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}
