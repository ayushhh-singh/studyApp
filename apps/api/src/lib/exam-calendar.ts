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
 * exams' nearer dates.
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
 * Upcoming dated rows for EVERY exam at a stage, soonest first. Await this in
 * the same `Promise.all` as the profile read, then narrow with `pickNextExam`.
 */
export function upcomingExamsQuery(today: string, stage: "prelims" | "mains" = "prelims") {
  return supabase()
    .from("exam_calendar")
    .select("exam_code, exam_stage, title_i18n, exam_date, is_tentative")
    .eq("exam_stage", stage)
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(UPCOMING_WINDOW);
}

/**
 * The soonest upcoming row belonging to `examCode`, or null.
 *
 * Returning null is CORRECT and expected for an exam whose dates have not been
 * seeded — the honest outcome is "no countdown", never another exam's date.
 */
export function pickNextExam(rows: unknown, examCode: string): UpcomingExamRow | null {
  const list = (rows ?? []) as UpcomingExamRow[];
  return list.find((r) => r.exam_code === examCode) ?? null;
}
