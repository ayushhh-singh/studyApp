/** IST is a fixed UTC+5:30 offset — mirrors apps/api/src/lib/ist.ts's istDateString exactly. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's IST calendar day, `YYYY-MM-DD` — for matching against a plan day's `date` field. */
export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
