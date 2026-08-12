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
import { getExamConfig } from "../lib/exam-config.js";
import { getUserExam } from "../lib/exams.js";
import { getDailyAnswerSet } from "./answer-set.js";

/** Reviews-in-a-day threshold that counts as a study day on its own. */
export const SRS_ACTIVITY_THRESHOLD = 10;
/** Answer-set items to complete for the Today checklist's answer item. */
export const ANSWER_SET_CHECKLIST_TARGET = 2;

export interface DailyProgress {
  /**
   * The GS daily quiz — the primary quiz. `daily_quiz_test_id`/`daily_quiz_done`
   * are kept as convenience aliases of the GS variant (the primary), so callers
   * that still think in terms of "the daily quiz" (e.g. the quiz_ready nudge)
   * point at GS.
   */
  daily_quiz_test_id: string | null;
  daily_quiz_done: boolean;
  gs_quiz_test_id: string | null;
  gs_quiz_done: boolean;
  csat_quiz_test_id: string | null;
  csat_quiz_done: boolean;
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
  /** Posted a discussion reply/thread or cast a post vote today. */
  community_activity_today: boolean;
}

async function headCount(build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await build();
  if (error) throw new HttpError(500, `count query failed: ${error.message}`);
  return count ?? 0;
}

/**
 * SRS cards due right now. Extracted so a caller that needs ONLY this number
 * doesn't have to pay for the whole of `getDailyProgress` (~10 counts plus the
 * day's answer set) — while still sharing one definition of "due", so the
 * Today checklist, the streak engine and the mentor's backlog tip can never
 * drift apart on what counts as a due card.
 */
export async function countSrsDue(userId: string, nowIso: string = new Date().toISOString()): Promise<number> {
  return headCount(() =>
    supabase()
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("fsrs_state->>due_at", nowIso),
  );
}

export async function getDailyProgress(userId: string, date: string = istToday()): Promise<DailyProgress> {
  const { startUtc, endUtc } = istDayRangeUtc(date);
  const nowIso = new Date().toISOString();

  // Which Prelims papers THIS user's exam carries a daily quiz for — resolved
  // via getExamConfig, never the UPPSC-only PRELIMS_GS1_PAPER_CODE/
  // PRELIMS_CSAT_PAPER_CODE constants directly (docs/multi-exam.md). An exam
  // with no ingested Prelims papers yet reports both as null, so
  // prelimsPaperCodes is empty and the lookup below is skipped entirely —
  // an honest "no quiz today" rather than matching every paper_code.
  const examCode = await getUserExam(userId);
  const { prelimsGs, prelimsCsat } = getExamConfig(examCode).papers;
  const prelimsPaperCodes = [prelimsGs, prelimsCsat].filter((c): c is string => !!c);

  // Today's daily quizzes (GS + CSAT, when this exam has them), paper-scoped. A
  // legacy pre-split blended quiz (paper_code NULL) is ignored here — only the
  // GS/CSAT rows drive today's progress.
  let rows: { id: string; paper_code: string | null }[] = [];
  if (prelimsPaperCodes.length > 0) {
    const { data: quizRows, error: quizErr } = await supabase()
      .from("tests")
      .select("id, paper_code")
      .eq("kind", "daily_quiz")
      .eq("is_published", true)
      .eq("scheduled_date", date)
      .in("paper_code", prelimsPaperCodes);
    if (quizErr) throw new HttpError(500, `daily quiz lookup failed: ${quizErr.message}`);
    rows = (quizRows ?? []) as { id: string; paper_code: string | null }[];
  }
  const gsQuizId = prelimsGs ? (rows.find((r) => r.paper_code === prelimsGs)?.id ?? null) : null;
  const csatQuizId = prelimsCsat ? (rows.find((r) => r.paper_code === prelimsCsat)?.id ?? null) : null;

  const quizDone = async (testId: string | null): Promise<boolean> => {
    if (!testId) return false;
    return (
      (await headCount(() =>
        supabase()
          .from("attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("test_id", testId)
          .not("submitted_at", "is", null),
      )) > 0
    );
  };
  const [gsQuizDone, csatQuizDone] = await Promise.all([quizDone(gsQuizId), quizDone(csatQuizId)]);

  const [attemptsToday, srsReviewsToday, submissionsToday, readTodayCount, answerSet, srsDue, postsToday, votesToday] =
    await Promise.all([
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
    getDailyAnswerSet(userId, date, examCode),
    countSrsDue(userId, nowIso),
    headCount(() =>
      supabase()
        .from("discussion_posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", startUtc)
        .lt("created_at", endUtc),
    ),
    headCount(() =>
      supabase()
        .from("post_votes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", startUtc)
        .lt("created_at", endUtc),
    ),
  ]);
  const readToday = readTodayCount > 0;

  return {
    // Aliases point at GS (the primary quiz); "done" is EITHER quiz done — see
    // buildChecklist / hadActivity: completing either the GS or the CSAT quiz
    // satisfies the single "Daily quiz" habit item and the streak.
    daily_quiz_test_id: gsQuizId,
    daily_quiz_done: gsQuizDone || csatQuizDone,
    gs_quiz_test_id: gsQuizId,
    gs_quiz_done: gsQuizDone,
    csat_quiz_test_id: csatQuizId,
    csat_quiz_done: csatQuizDone,
    attempts_today: attemptsToday,
    answer_completed: answerSet.completed_count,
    answer_total: answerSet.items.length,
    srs_due: srsDue,
    srs_reviews_today: srsReviewsToday,
    answer_submissions_today: submissionsToday,
    read_today: readToday,
    community_activity_today: postsToday > 0 || votesToday > 0,
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
    // The single "Daily quiz" habit item ticks when EITHER the GS or CSAT quiz
    // is done (p.daily_quiz_done = gs_done || csat_done). Keeping it one item
    // keeps the daily habit attainable — the streak rewards showing up, not
    // grinding both papers (35+ questions) every day; CSAT is qualifying-only.
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
 * The any-activity rule: a study day counts if the user did EITHER daily quiz
 * (daily_quiz_done = gs_done || csat_done), reviewed 10+ SRS cards, submitted an
 * answer, took a test attempt, OR completed the whole Today checklist. (Both
 * quizzes are attempts, so p.attempts_today >= 1 already covers either — the
 * explicit daily_quiz_done branch just keeps the rule self-documenting.)
 */
export function hadActivity(p: DailyProgress): boolean {
  const checklist = buildChecklist(p);
  return (
    p.daily_quiz_done ||
    p.attempts_today >= 1 ||
    p.srs_reviews_today >= SRS_ACTIVITY_THRESHOLD ||
    p.answer_submissions_today >= 1 ||
    p.community_activity_today ||
    checklist.completed === checklist.total
  );
}
