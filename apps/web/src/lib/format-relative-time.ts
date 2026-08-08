/**
 * Compact "how long ago" formatting for scannable activity lists.
 *
 * Built on `Intl.RelativeTimeFormat`, which is locale-aware for BOTH of this
 * app's locales out of the box — so this needs no new i18n message keys and no
 * hand-written Hindi pluralisation (Devanagari relative phrasing is genuinely
 * irregular; "2 दिन पहले" vs "1 दिन पहले" is the easy case, and a hand-rolled
 * table gets the rest wrong). Absolute dates elsewhere in the admin surface stay
 * on `toLocaleDateString()`; this is specifically for the at-a-glance
 * "is this account still alive?" read.
 */

/** Threshold table, largest unit first — the first unit the delta clears wins. */
const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 365 * 24 * 3600 },
  { unit: "month", seconds: 30 * 24 * 3600 },
  { unit: "day", seconds: 24 * 3600 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/**
 * `iso` → e.g. "3 days ago" / "3 दिन पहले". Returns null for a null/unparseable
 * input so the caller renders its own "never" state rather than a bogus date —
 * `new Date("garbage")` yields NaN, which would otherwise format as "NaN years
 * ago" instead of failing visibly.
 *
 * A FUTURE timestamp is clamped to "now" rather than rendered as "in 3 days":
 * these are activity records, so a future value means clock skew between this
 * browser and the DB, and "in 3 days" reads as a bug to the viewer.
 */
export function formatRelativeTime(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const deltaSeconds = Math.max(0, (Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });

  for (const { unit, seconds } of UNITS) {
    if (deltaSeconds >= seconds) {
      return rtf.format(-Math.floor(deltaSeconds / seconds), unit);
    }
  }
  // Under a minute — `numeric: "auto"` renders this as "now"/"अभी", not "0 seconds ago".
  return rtf.format(0, "second");
}
