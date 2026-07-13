/**
 * Weekly digest: this week's (last 7 IST days) questions, accuracy, answers,
 * SRS reviews, and current streak. Backs the dashboard digest card and the
 * server-rendered share image.
 */
import type { LeaderboardEntry, WeeklyDigest } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getWeeklyDigest(userId: string, today: string = istToday()): Promise<WeeklyDigest> {
  const weekStart = shiftDate(today, -6);
  const startUtc = istDayRangeUtc(weekStart).startUtc;
  const endUtc = istDayRangeUtc(today).endUtc;

  // Attempts submitted this week → their graded answers drive questions + accuracy.
  const { data: attempts, error: aErr } = await supabase()
    .from("attempts")
    .select("id")
    .eq("user_id", userId)
    .not("submitted_at", "is", null)
    .gte("submitted_at", startUtc)
    .lt("submitted_at", endUtc);
  if (aErr) throw new HttpError(500, `weekly attempts lookup failed: ${aErr.message}`);
  const attemptIds = (attempts ?? []).map((r) => r.id as string);

  let questionsAttempted = 0;
  let correct = 0;
  if (attemptIds.length > 0) {
    const { data: answers, error: ansErr } = await supabase()
      .from("attempt_answers")
      .select("is_correct")
      .in("attempt_id", attemptIds)
      .not("is_correct", "is", null);
    if (ansErr) throw new HttpError(500, `weekly answers lookup failed: ${ansErr.message}`);
    for (const a of answers ?? []) {
      questionsAttempted += 1;
      if (a.is_correct) correct += 1;
    }
  }

  const [{ count: answersEvaluated, error: eErr }, { count: srsReviews, error: sErr }, profileRes] = await Promise.all([
    supabase().from("answer_submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "complete").gte("created_at", startUtc).lt("created_at", endUtc),
    supabase().from("srs_reviews").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("reviewed_at", startUtc).lt("reviewed_at", endUtc),
    supabase().from("users_profile").select("streak_count").eq("id", userId).maybeSingle(),
  ]);
  if (eErr) throw new HttpError(500, `weekly evaluations count failed: ${eErr.message}`);
  if (sErr) throw new HttpError(500, `weekly srs count failed: ${sErr.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);

  return {
    week_start: weekStart,
    week_end: today,
    questions_attempted: questionsAttempted,
    accuracy_pct: questionsAttempted > 0 ? round2((correct / questionsAttempted) * 100) : null,
    answers_evaluated: answersEvaluated ?? 0,
    srs_reviews: srsReviews ?? 0,
    streak_count: (profileRes.data?.streak_count as number | undefined) ?? 0,
  };
}

/**
 * Leaderboard — BUILT BUT HIDDEN (no nav entry) until opt-in social features
 * land. Ranks users by streak, then questions attempted. With one dev user
 * today it's a single row, but the query doesn't assume that.
 */
export async function getLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
  const { data: profiles, error } = await supabase()
    .from("users_profile")
    .select("id, display_name, streak_count")
    .order("streak_count", { ascending: false })
    .limit(100);
  if (error) throw new HttpError(500, `leaderboard lookup failed: ${error.message}`);

  const rows = (profiles ?? []) as { id: string; display_name: string | null; streak_count: number }[];
  const entries: LeaderboardEntry[] = [];
  for (const p of rows) {
    const { data: answers } = await supabase()
      .from("attempt_answers")
      .select("is_correct, attempts!inner(user_id)")
      .eq("attempts.user_id", p.id)
      .not("is_correct", "is", null);
    const graded = (answers ?? []) as { is_correct: boolean }[];
    const correct = graded.filter((a) => a.is_correct).length;
    entries.push({
      rank: 0,
      user_id: p.id,
      display_name: p.display_name,
      streak_count: p.streak_count,
      questions_attempted: graded.length,
      accuracy_pct: graded.length > 0 ? round2((correct / graded.length) * 100) : null,
      is_you: p.id === userId,
    });
  }
  entries.sort((a, b) => b.streak_count - a.streak_count || b.questions_attempted - a.questions_attempted);
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}
