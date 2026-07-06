/**
 * Streak engine. A "study day" is any IST day the user met the any-activity rule
 * (daily quiz done, 10+ SRS reviews, 1 answer submission, 1 test attempt, or the
 * whole Today checklist — see services/daily-progress.ts). refreshStreak runs on
 * every dashboard load AND nightly (00:05 IST) so streak_count stays honest even
 * if the app isn't opened.
 *
 * Rules (lazy, idempotent):
 *  - Already counted today (last_active_date == today): no-op.
 *  - Activity today: streak += 1 if last_active_date was yesterday, else reset to
 *    1 (new streak); set last_active_date = today. (incremented_today = true — the
 *    flame animates once.)
 *  - No activity yet today: if last_active_date is older than yesterday the streak
 *    is broken → reset to 0; if it's yesterday the streak survives on today's
 *    grace period (not yet incremented).
 */
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { devUserId } from "../lib/dev-user.js";
import { istToday, shiftDate } from "../lib/ist.js";
import { getDailyProgress, hadActivity, type DailyProgress } from "../services/daily-progress.js";

export interface StreakState {
  streak_count: number;
  last_active_date: string | null;
  /** This refresh crossed the threshold and bumped the streak (drives the flame animation). */
  incremented_today: boolean;
  /** Today already counts toward the streak. */
  active_today: boolean;
}

export async function refreshStreak(
  userId: string,
  today: string = istToday(),
  progress?: DailyProgress,
): Promise<StreakState> {
  const { data: profile, error } = await supabase()
    .from("users_profile")
    .select("streak_count, last_active_date")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  let streak = (profile?.streak_count as number | undefined) ?? 0;
  const lastActive = (profile?.last_active_date as string | null) ?? null;
  const yesterday = shiftDate(today, -1);

  if (lastActive === today) {
    return { streak_count: streak, last_active_date: lastActive, incremented_today: false, active_today: true };
  }

  const p = progress ?? (await getDailyProgress(userId, today));
  if (hadActivity(p)) {
    const newStreak = lastActive === yesterday ? streak + 1 : 1;
    const { error: upErr } = await supabase()
      .from("users_profile")
      .update({ streak_count: newStreak, last_active_date: today })
      .eq("id", userId);
    if (upErr) throw new HttpError(500, `streak update failed: ${upErr.message}`);
    return { streak_count: newStreak, last_active_date: today, incremented_today: true, active_today: true };
  }

  // No activity yet today — break a stale streak (last active before yesterday).
  if (lastActive && lastActive < yesterday && streak !== 0) {
    const { error: upErr } = await supabase().from("users_profile").update({ streak_count: 0 }).eq("id", userId);
    if (upErr) throw new HttpError(500, `streak reset failed: ${upErr.message}`);
    streak = 0;
  }
  return { streak_count: streak, last_active_date: lastActive, incremented_today: false, active_today: false };
}

/** Nightly settle just after IST midnight (keeps the streak honest without an app open). */
export async function runStreakNightly(userId: string = devUserId()): Promise<StreakState> {
  const state = await refreshStreak(userId);
  logger.info({ state }, "streak: nightly settle");
  return state;
}
