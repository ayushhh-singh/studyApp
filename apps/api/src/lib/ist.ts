/**
 * IST (Asia/Kolkata, fixed UTC+5:30, no DST) date helpers.
 *
 * This app is UP/India-specific: "today" — for the daily quiz, the daily answer
 * set, current affairs, the streak engine, and the exam countdown — must follow
 * the IST calendar day, never server UTC. Otherwise there is a ~5.5h window
 * (18:30–24:00 UTC) where those all resolve to the wrong day. Centralised here
 * so every feature agrees on the same day boundary.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar day for an instant (default: now), as `YYYY-MM-DD`. */
export function istDateString(at: number = Date.now()): string {
  return new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's IST calendar day, `YYYY-MM-DD`. */
export function istToday(): string {
  return istDateString();
}

/** Shift a `YYYY-MM-DD` date string by `days` (may be negative), staying in the date domain. */
export function shiftDate(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * 24 * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The MONDAY of the ISO week containing `dateStr`, as `YYYY-MM-DD` — this
 * codebase's ONE definition of "which week is it".
 *
 * Lives here, rather than beside any one caller, because a second copy is how
 * two features silently end up on different week boundaries. That is not
 * hypothetical: the current-affairs weekly assembly used to derive its week as
 * `floor(daysBetween("1970-01-01", date) / 7)`, and since the epoch was a
 * THURSDAY that rolled over mid-week while its cron built on Monday — so the
 * weekly CA quiz vanished from the page for four days out of every seven.
 * Anything weekly must anchor here.
 */
export function istWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const isoDay = day === 0 ? 7 : day; // 1=Mon..7=Sun
  return shiftDate(dateStr, -(isoDay - 1));
}

/** Whole days from `fromDateStr` to `toDateStr` (both `YYYY-MM-DD`); negative if `to` precedes `from`. */
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = Date.parse(`${fromDateStr}T00:00:00Z`);
  const to = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((to - from) / (24 * 3600 * 1000));
}

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_HI = [
  "जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून", "जुल", "अग", "सित", "अक्टू", "नव", "दिस",
];

/**
 * The UTC instant range [start, end) covering a given IST calendar day —
 * IST day D is [D 00:00 IST, D+1 00:00 IST) = [D-1 18:30 UTC, D 18:30 UTC).
 * For filtering timestamptz columns (attempts, reviews, events, submissions) by
 * "which IST day did this happen on".
 */
export function istDayRangeUtc(date: string): { startUtc: string; endUtc: string } {
  const startMs = Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 24 * 3600 * 1000).toISOString(),
  };
}

/** The UTC ISO instant for a wall-clock IST time (hour:minute) on an IST date. */
export function istClockUtc(date: string, hour: number, minute = 0): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + (hour * 60 + minute) * 60 * 1000;
  return new Date(ms).toISOString();
}

/** Bilingual "7 Jul 2026" / "7 जुल 2026" from a `YYYY-MM-DD` string, for test/quiz titles. */
export function formatDateBilingual(dateStr: string): { en: string; hi: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = String(d);
  return {
    en: `${day} ${MONTHS_EN[m - 1]} ${y}`,
    hi: `${day} ${MONTHS_HI[m - 1]} ${y}`,
  };
}
