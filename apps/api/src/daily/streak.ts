/**
 * Streak engine. A "study day" is any IST day the user met the any-activity rule
 * (daily quiz done, 10+ SRS reviews, 1 answer submission, 1 test attempt, or the
 * whole Today checklist — see services/daily-progress.ts). refreshStreak runs on
 * every dashboard load AND nightly (00:05 IST) so streak_count stays honest even
 * if the app isn't opened.
 *
 * Streak Freeze (game layer): the user banks freezes (max 2), earning one each
 * time the streak completes another 7 days. A freeze is consumed AUTOMATICALLY to
 * bridge a missed day so the streak survives — never bought, never manual. The
 * count holds (a freeze protects, it doesn't grow the streak).
 *
 * Rules (lazy, idempotent):
 *  - Already counted today (last_active_date == today): no-op.
 *  - Activity today: streak advances if the gap since last_active_date is 1 day,
 *    or if banked freezes can bridge the skipped days; otherwise it resets to 1.
 *    Crossing a multiple of 7 earns a freeze (capped at the bank max).
 *  - No activity yet today: a gap of exactly 1 day is today's grace period. A
 *    larger gap means a full day was skipped — a freeze is spent to hold the
 *    streak if one is banked, else the streak breaks to 0.
 */
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { devUserId } from "../lib/dev-user.js";
import { daysBetween, istToday, shiftDate } from "../lib/ist.js";
import { getDailyProgress, hadActivity, type DailyProgress } from "../services/daily-progress.js";

/** Freezes earned per this many streak days, and the hard bank cap. */
export const FREEZE_EARN_EVERY = 7;
export const FREEZE_BANK_MAX = 2;

export interface StreakState {
  streak_count: number;
  last_active_date: string | null;
  /** This refresh crossed the threshold and bumped the streak (drives the flame animation). */
  incremented_today: boolean;
  /** Today already counts toward the streak. */
  active_today: boolean;
  /** Banked streak freezes (0–2). */
  streak_freezes: number;
  /** A freeze recently protected the streak — surface "Freeze used — streak safe". */
  freeze_used_recently: boolean;
}

export async function refreshStreak(
  userId: string,
  today: string = istToday(),
  progress?: DailyProgress,
): Promise<StreakState> {
  const { data: profile, error } = await supabase()
    .from("users_profile")
    .select("streak_count, last_active_date, streak_freezes, streak_freeze_used_on")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);

  let streak = (profile?.streak_count as number | undefined) ?? 0;
  const lastActive = (profile?.last_active_date as string | null) ?? null;
  let freezes = (profile?.streak_freezes as number | undefined) ?? 0;
  let freezeUsedOn = (profile?.streak_freeze_used_on as string | null) ?? null;
  const yesterday = shiftDate(today, -1);

  const usedRecently = () => !!freezeUsedOn && daysBetween(freezeUsedOn, today) <= 1;

  if (lastActive === today) {
    return {
      streak_count: streak,
      last_active_date: lastActive,
      incremented_today: false,
      active_today: true,
      streak_freezes: freezes,
      freeze_used_recently: usedRecently(),
    };
  }

  const p = progress ?? (await getDailyProgress(userId, today));
  const active = hadActivity(p);

  let newLast = lastActive;
  let incremented = false;
  let freezeConsumedNow = false;

  if (!lastActive) {
    // Brand-new streak (or fully reset): activity today starts it at 1.
    if (active) {
      streak = 1;
      newLast = today;
      incremented = true;
    }
  } else {
    const gap = daysBetween(lastActive, today); // >= 1 (== today handled above)
    const missed = gap - 1; // full days skipped between last_active and today

    if (active) {
      if (missed <= 0) {
        streak += 1;
      } else if (missed <= freezes) {
        freezes -= missed;
        freezeUsedOn = yesterday;
        freezeConsumedNow = true;
        streak += 1; // freezes bridged the gap; today extends the chain
      } else {
        streak = 1; // gap too large to freeze — fresh streak
      }
      newLast = today;
      incremented = true;
      // Earn a freeze on every 7th day (banked, capped).
      if (streak > 0 && streak % FREEZE_EARN_EVERY === 0) {
        freezes = Math.min(FREEZE_BANK_MAX, freezes + 1);
      }
    } else {
      // No activity today yet.
      if (missed <= 0) {
        // gap == 1: today's grace period, streak survives untouched.
      } else if (missed <= freezes) {
        freezes -= missed;
        freezeUsedOn = yesterday;
        freezeConsumedNow = true;
        newLast = yesterday; // freeze holds the chain up to yesterday
      } else {
        streak = 0; // broken
      }
    }
  }

  const changed =
    streak !== ((profile?.streak_count as number | undefined) ?? 0) ||
    newLast !== lastActive ||
    freezes !== ((profile?.streak_freezes as number | undefined) ?? 0) ||
    freezeUsedOn !== ((profile?.streak_freeze_used_on as string | null) ?? null);

  if (changed) {
    const { error: upErr } = await supabase()
      .from("users_profile")
      .update({ streak_count: streak, last_active_date: newLast, streak_freezes: freezes, streak_freeze_used_on: freezeUsedOn })
      .eq("id", userId);
    if (upErr) throw new HttpError(500, `streak update failed: ${upErr.message}`);
  }

  return {
    streak_count: streak,
    last_active_date: newLast,
    incremented_today: incremented,
    active_today: active,
    streak_freezes: freezes,
    freeze_used_recently: freezeConsumedNow || usedRecently(),
  };
}

/** Nightly settle just after IST midnight (keeps the streak honest without an app open). */
export async function runStreakNightly(userId: string = devUserId()): Promise<StreakState> {
  const state = await refreshStreak(userId);
  logger.info({ state }, "streak: nightly settle");
  return state;
}
