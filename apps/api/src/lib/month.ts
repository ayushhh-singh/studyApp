/**
 * Shared "YYYY-MM" calendar-month helpers for the current-affairs magazine
 * (services/magazine.ts's two editions + ca/deepdive.ts's ranking/generation) —
 * one place so both agree on month labels and date-range bounds.
 */
import { istToday } from "./ist.js";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_HI = [
  "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
  "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
];

/** The current IST calendar month, "YYYY-MM". */
export function currentIstMonth(): string {
  return istToday().slice(0, 7);
}

/** The calendar month before `month` ("YYYY-MM"), rolling the year at January. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/**
 * The IST calendar month before the current one — i.e. the most recent FULLY
 * ELAPSED month. This is what a monthly job running on the 1st should compile:
 * on 1 Aug (IST) it returns "2026-07", covering July 1-31 complete.
 *
 * IST, not UTC, so the job agrees with `current_affairs_items.date` — which
 * pipeline.ts stamps as `istDateString(pubDate)`. A UTC-derived month would
 * disagree for the 18:30-24:00 UTC window on the 1st, which is precisely when
 * a "run on the 1st" cron is most likely to fire.
 */
export function previousIstMonth(): string {
  return previousMonth(currentIstMonth());
}

/**
 * Is `month` a PUBLISHED magazine issue — i.e. has that IST calendar month
 * fully elapsed?
 *
 * A magazine is a monthly issue, not a live feed: August's issue publishes on
 * 1 September, once August is complete and its deep dives can be generated over
 * the whole month. Before this gate existed, both editions were computed purely
 * on demand with no completeness check, so the CURRENT month was already served
 * as a finished magazine mid-month — on 8 August the index listed a "August
 * 2026" issue whose contents silently grew every 6h as ca:run published more
 * items, and which necessarily had 0 deep dives (nothing ranks a month that has
 * not ended).
 *
 * Strictly `<` the current month, so a future month is excluded too — the month
 * comes from a URL param and `"2027-01"` is a well-formed value.
 */
export function isMonthPublished(month: string): boolean {
  return month < currentIstMonth();
}

export function monthLabel(month: string): { hi: string; en: string } {
  const [y, m] = month.split("-").map(Number);
  const idx = Math.max(0, Math.min(11, (m || 1) - 1));
  return { en: `${MONTHS_EN[idx]} ${y}`, hi: `${MONTHS_HI[idx]} ${y}` };
}

/** First day of `month` and first day of the following month, as YYYY-MM-DD. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}
