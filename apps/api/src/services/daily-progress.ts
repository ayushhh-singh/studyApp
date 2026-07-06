/**
 * The single source of truth for "what has the user done today" — feeds both
 * the Dashboard's guided "Today" checklist and the streak engine's any-activity
 * rule, so the two never disagree.
 *
 * All day-boundary queries use the IST calendar day (istDayRangeUtc), matching
 * the daily quiz / answer set / current affairs.
 */
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istDayRangeUtc, istToday } from "../lib/ist.js";
import { getDailyAnswerSet } from "./answer-set.js";

/** Reviews-in-a-day threshold that counts as a study day on its own. */
export const SRS_ACTIVITY_THRESHOLD = 10;
/** Answer-set items to complete for the Today checklist's answer item. */
export const ANSWER_SET_CHECKLIST_TARGET = 2;

export interface DailyProgress {
  /** Today's daily-quiz test id, if one exists. */
  daily_quiz_test_id: string | null;
  daily_quiz_done: boolean;
  /** Attempts (any test) the user submitted today. */
  attempts_today: number;
  /** Answer-set items with a completed evaluation, and the day's set size. */
  answer_completed: number;
  answer_total: number;
  /** SRS cards due right now, and reviews logged today. */
  srs_due: number;
  srs_reviews_today: number;
  /** Answer submissions created today. */
  answer_submissions_today: number;
  /** Fired a reading event today (note_read / syllabus_node_view). */
  read_today: boolean;
}

async function headCount(build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await build();
  if (error) throw new HttpError(500, `count query failed: ${error.message}`);
  return count ?? 0;
}

export async function getDailyProgress(userId: string, date: string = istToday()): Promise<DailyProgress> {
  const { startUtc, endUtc } = istDayRangeUtc(date);
  const nowIso = new Date().toISOString();

  // Today's daily quiz + whether it's been submitted.
  const { data: quiz, error: quizErr } = await supabase()
    .from("tests")
    .select("id")
    .eq("kind", "daily_quiz")
    .eq("scheduled_date", date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (quizErr) throw new HttpError(500, `daily quiz lookup failed: ${quizErr.message}`);
  const dailyQuizId = (quiz?.id as string | undefined) ?? null;

  let dailyQuizDone = false;
  if (dailyQuizId) {
    dailyQuizDone =
      (await headCount(() =>
        supabase()
          .from("attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("test_id", dailyQuizId)
          .not("submitted_at", "is", null),
      )) > 0;
  }

  const [attemptsToday, srsReviewsToday, submissionsToday, readTodayCount, answerSet, srsDue] = await Promise.all([
    headCount(() =>
      supabase()
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("submitted_at", "is", null)
        .gte("submitted_at", startUtc)
        .lt("submitted_at", endUtc),
    ),
    headCount(() =>
      supabase()
        .from("srs_reviews")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("reviewed_at", startUtc)
        .lt("reviewed_at", endUtc),
    ),
    headCount(() =>
      supabase()
        .from("answer_submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", startUtc)
        .lt("created_at", endUtc),
    ),
    headCount(() =>
      supabase()
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("name", ["note_read", "syllabus_node_view"])
        .gte("created_at", startUtc)
        .lt("created_at", endUtc),
    ),
    getDailyAnswerSet(userId, date),
    headCount(() =>
      supabase()
        .from("srs_cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .lte("fsrs_state->>due_at", nowIso),
    ),
  ]);
  const readToday = readTodayCount > 0;

  return {
    daily_quiz_test_id: dailyQuizId,
    daily_quiz_done: dailyQuizDone,
    attempts_today: attemptsToday,
    answer_completed: answerSet.completed_count,
    answer_total: answerSet.items.length,
    srs_due: srsDue,
    srs_reviews_today: srsReviewsToday,
    answer_submissions_today: submissionsToday,
    read_today: readToday,
  };
}

export interface ChecklistItem {
  key: "daily_quiz" | "answer_set" | "revision" | "continue_reading";
  done: boolean;
  current: number;
  target: number;
}

/** The guided "Today" checklist derived from progress. */
export function buildChecklist(p: DailyProgress): { items: ChecklistItem[]; completed: number; total: number } {
  const items: ChecklistItem[] = [
    { key: "daily_quiz", done: p.daily_quiz_done, current: p.daily_quiz_done ? 1 : 0, target: 1 },
    {
      key: "answer_set",
      done: p.answer_completed >= ANSWER_SET_CHECKLIST_TARGET,
      current: Math.min(p.answer_completed, ANSWER_SET_CHECKLIST_TARGET),
      target: ANSWER_SET_CHECKLIST_TARGET,
    },
    // Revision: "clear your due cards". If nothing is due, it's already done.
    { key: "revision", done: p.srs_due === 0, current: p.srs_reviews_today, target: p.srs_reviews_today + p.srs_due },
    { key: "continue_reading", done: p.read_today, current: p.read_today ? 1 : 0, target: 1 },
  ];
  const completed = items.filter((i) => i.done).length;
  return { items, completed, total: items.length };
}

/**
 * The any-activity rule: a study day counts if the user did the daily quiz,
 * reviewed 10+ SRS cards, submitted an answer, took a test attempt, OR completed
 * the whole Today checklist.
 */
export function hadActivity(p: DailyProgress): boolean {
  const checklist = buildChecklist(p);
  return (
    p.daily_quiz_done ||
    p.attempts_today >= 1 ||
    p.srs_reviews_today >= SRS_ACTIVITY_THRESHOLD ||
    p.answer_submissions_today >= 1 ||
    checklist.completed === checklist.total
  );
}
