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
