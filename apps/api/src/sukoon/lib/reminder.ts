/**
 * Sukoon F5/F11 — next-reminder computation. Storing `reminder_time` already
 * works (PATCH /profile, since Session 2/F1); this is the pure "when does the
 * next nudge fire" function the future push cron (blueprint Session 12) will
 * call, exposed today via GET /mood/today's `next_reminder_at` so the check-in
 * screen can already show it.
 */
import { istClockUtc, istToday, shiftDate } from "../../lib/ist.js";

/**
 * `reminderTime` is a Postgres `time` value, e.g. "20:00:00" or "20:00" — only
 * the HH:MM prefix is used. Returns null when no reminder is set.
 *
 * Logic: if today's reminder instant hasn't happened yet AND the user hasn't
 * already checked in today, the next reminder is today at that time;
 * otherwise (already checked in, or today's time has passed) it's tomorrow.
 */
export function nextReminderAt(
  reminderTime: string | null,
  checkedInToday: boolean,
  now: number = Date.now(),
): string | null {
  if (!reminderTime) return null;
  const match = /^(\d{2}):(\d{2})/.exec(reminderTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const today = istToday();
  const todayInstant = istClockUtc(today, hour, minute);
  if (!checkedInToday && Date.parse(todayInstant) > now) return todayInstant;

  return istClockUtc(shiftDate(today, 1), hour, minute);
}
