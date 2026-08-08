/** IST is a fixed UTC+5:30 offset — mirrors apps/api/src/lib/ist.ts's istDateString exactly. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar day, `YYYY-MM-DD` — for matching against a plan day's `date` field. */
export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` by whole days — mirrors apps/api/src/lib/ist.ts's shiftDate. */
export function shiftDate(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * The MONDAY of the ISO week containing `dateStr` — mirrors
 * apps/api/src/lib/ist.ts's `istWeekStart`, which is what the weekly
 * current-affairs assembly is keyed to. Keep the two in step: this is what lets
 * the UI tell a student exactly when the next weekly set lands.
 */
export function istWeekStart(dateStr: string): string {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return shiftDate(dateStr, -((day === 0 ? 7 : day) - 1));
}
