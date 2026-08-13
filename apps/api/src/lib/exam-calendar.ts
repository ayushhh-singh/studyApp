/**
 * Exam-scoped "next exam date" lookup.
 *
 * Migration 0106 added `exam_calendar.exam_code`. Before it, the four countdown
 * call sites (dashboard greeting, profile card, learner profile, study plan) all
 * took "the next upcoming prelims row" with no exam filter — which silently
 * counts a UPPSC aspirant down to a UPSC date the moment a second exam's dates
 * are seeded.
 *
 * The naive fix (filter in SQL) would force the calendar read to wait on the
 * profile read for the user's target_exam, serialising two round trips on the
 * hottest endpoint in the app. Instead: fetch a small window of upcoming rows
 * for ALL exams in parallel with the profile, then pick the user's in memory.
 */
import { supabase } from "./supabase.js";

/**
 * How many upcoming rows to pull. Generous: the table holds a handful of dates
 * per exam per year, so this is one small indexed read, and it must be wide
 * enough that a user's own exam is never pushed out of the window by other
 * exams' nearer dates — now including other exams' MAINS dates, since the query
 * below is stage-agnostic. At 3 exams x 2 stages x a couple of years this is
 * still an order of magnitude of headroom.
 */
const UPCOMING_WINDOW = 50;

export interface UpcomingExamRow {
  exam_code: string;
  exam_stage: string;
  title_i18n: { hi: string; en: string };
  exam_date: string;
  is_tentative: boolean;
}

/**
 * Upcoming dated rows for EVERY exam at EVERY stage, soonest first. Await this
 * in the same `Promise.all` as the profile read, then narrow with
 * `pickNextExam`.
 *
 * ⚑ STAGE-AGNOSTIC ON PURPOSE. This used to take `stage: "prelims" | "mains" =
 * "prelims"`, and all four call sites took the default — so the countdown was
 * permanently pinned to Prelims and a Mains date could never surface no matter
 * what was seeded. That was invisible while `exam_calendar` held prelims rows
 * only; migration 0126 seeded UPSC Mains 2027 and made it real.
 *
 * The rule is now simply "the next milestone in your exam's own sequence",
 * which needs no preference to store and no maintenance: before Prelims the
 * soonest row IS Prelims, and the day after it the soonest row becomes Mains.
 * A `target_stage` column on the profile was considered and rejected — it is
 * derivable from the calendar, so it could only ever go stale.
 *
 * The parameter was REMOVED rather than defaulted to "any": a defaulted
 * parameter lets a caller silently keep the old behaviour, which is exactly how
 * this got pinned to Prelims in the first place (docs/OUTSTANDING.md M24).
 * Ordering by date is what makes "soonest of any stage" fall out for free.
 */
export function upcomingExamsQuery(today: string) {
  return supabase()
    .from("exam_calendar")
    .select("exam_code, exam_stage, title_i18n, exam_date, is_tentative")
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(UPCOMING_WINDOW);
}

/**
 * The soonest upcoming row belonging to `examCode` — at EITHER stage, since
 * `upcomingExamsQuery` no longer filters by one and returns date-ordered rows.
 * So this is "your next milestone", which rolls Prelims -> Mains on its own.
 *
 * Returning null is CORRECT and expected for an exam whose dates have not been
 * seeded — the honest outcome is "no countdown", never another exam's date.
 * That is also the honest outcome for UPPSC's Mains today: the commission does
 * not announce it until the Prelims result, so there is nothing to count to
 * (migration 0126 explains why no row was invented for it).
 */
export function pickNextExam(rows: unknown, examCode: string): UpcomingExamRow | null {
  const list = (rows ?? []) as UpcomingExamRow[];
  return list.find((r) => r.exam_code === examCode) ?? null;
}
