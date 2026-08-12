/**
 * Weekly digest: this week's (last 7 IST days) questions, accuracy, answers,
 * SRS reviews, and current streak. Backs the dashboard digest card AND the
 * server-rendered share image (services/share-image.ts's renderWeeklyDigestPng)
 * — both consume the exact same object, so scoping it here scopes both call
 * sites at once.
 *
 * EXAM SCOPING (2026-07-30, found auditing the share-image endpoints for
 * cross-exam bleed per docs/multi-exam.md): `examCode` is REQUIRED, not
 * defaulted — a defaulted trailing param lets a caller silently keep the old,
 * unscoped behaviour (the exact mistake CLAUDE.md's M11/M14 edge-case audit
 * caught twice already: getMasteryMap's targetExam, then getCutoffs' own).
 * `questions_attempted`/`accuracy_pct` (from `attempts`) and
 * `answers_evaluated` (from `answer_submissions`) are real per-exam concepts —
 * an attempt belongs to a test, which carries `tests.exam_code` (0106 §5,
 * NEEDS-COLUMN, not derivable); an evaluation belongs to an exam via
 * `evaluations.exam_code` (0109 §5). Without scoping, a user who has EVER
 * attempted a test or submitted an answer under a different exam this week —
 * exactly what switching `target_exam` mid-week produces — would see that
 * exam's numbers silently folded into THIS exam's digest and share image.
 * `srs_reviews` is DELIBERATELY left unscoped, but the reason CHANGED with 0124:
 * the deck is no longer shared (0124 reversed 0106 §13). It stays unscoped
 * because `srs_reviews` has no exam column and a review is a record of the
 * user's own past behaviour, not of a deck's contents — and since the due queue
 * is now exam-scoped, every FUTURE review is single-exam anyway, so the only
 * mixing left is historical. Same reasoning as getStats' retention_pct.
 * `streak_count` needs no join: it already reads the CURRENTLY ACTIVE exam's
 * live value straight off `users_profile` (the park/restore swap in
 * services/profile.ts's updateProfile keeps that column meaning "this exam's
 * streak" at all times — see migration 0111).
 */
import type { LeaderboardEntry, WeeklyDigest } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";
import { getUserExam } from "../lib/exams.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getWeeklyDigest(
  userId: string,
  examCode: string,
  today: string = istToday(),
): Promise<WeeklyDigest> {
  const weekStart = shiftDate(today, -6);
  const startUtc = istDayRangeUtc(weekStart).startUtc;
  const endUtc = istDayRangeUtc(today).endUtc;

  // Attempts submitted this week → their graded answers drive questions + accuracy.
  // `tests!inner(exam_code)` scopes to THIS exam's attempts only — an attempt
  // whose test was since deleted (test_id null) has no exam to attribute to and
  // is correctly excluded from every exam's count, not just this one.
  const { data: attempts, error: aErr } = await supabase()
    .from("attempts")
    .select("id, tests!inner(exam_code)")
    .eq("user_id", userId)
    .eq("tests.exam_code", examCode)
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
    supabase()
      .from("answer_submissions")
      .select("id, evaluations!inner(exam_code)", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "complete")
      .eq("evaluations.exam_code", examCode)
      .gte("created_at", startUtc)
      .lt("created_at", endUtc),
    // Deliberately NOT exam-scoped — see the function doc comment.
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
 *
 * EXAM SCOPING (2026-07-30, U3 sibling audit): "hidden from nav" does not
 * mean unreachable — `GET /leaderboard` (routes/engagement.ts) is a real,
 * live route, and this had NO exam scoping at all, which is the exact thing
 * M9 already decided the app's real (visible) scoreboards must never do
 * ("boards/community are exam-separated"). Two fixes: (1) only pool users
 * whose CURRENTLY ACTIVE exam is this one — `streak_count` always means
 * "this user's live streak for their currently active exam" (the
 * park/restore swap in updateProfile, migration 0111), so ranking it against
 * a user on a DIFFERENT active exam compares two incommensurable numbers;
 * (2) each user's graded-answer count/accuracy is scoped to attempts on
 * tests belonging to that same exam, via a two-step attempt-ids-then-answers
 * lookup mirroring getWeeklyDigest's own established pattern above — this
 * avoids an unproven two-level-deep nested embed filter
 * (`attempts.tests.exam_code`) for a low-traffic, unlinked surface.
 */
export async function getLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
  const examCode = await getUserExam(userId);
  const { data: profiles, error } = await supabase()
    .from("users_profile")
    .select("id, display_name, streak_count")
    .eq("target_exam", examCode)
    .order("streak_count", { ascending: false })
    .limit(100);
  if (error) throw new HttpError(500, `leaderboard lookup failed: ${error.message}`);

  const rows = (profiles ?? []) as { id: string; display_name: string | null; streak_count: number }[];
  const entries: LeaderboardEntry[] = [];
  for (const p of rows) {
    const { data: examAttempts, error: attemptsError } = await supabase()
      .from("attempts")
      .select("id, tests!inner(exam_code)")
      .eq("user_id", p.id)
      .eq("tests.exam_code", examCode);
    if (attemptsError) throw new HttpError(500, `leaderboard attempts lookup failed: ${attemptsError.message}`);
    const attemptIds = (examAttempts ?? []).map((a) => a.id as string);

    let graded: { is_correct: boolean }[] = [];
    if (attemptIds.length > 0) {
      const { data: answers, error: answersError } = await supabase()
        .from("attempt_answers")
        .select("is_correct")
        .in("attempt_id", attemptIds)
        .not("is_correct", "is", null);
      if (answersError) throw new HttpError(500, `leaderboard answers lookup failed: ${answersError.message}`);
      graded = (answers ?? []) as { is_correct: boolean }[];
    }
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
