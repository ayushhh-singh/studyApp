/**
 * Read side of the daily-engagement engine: the daily-quiz archive (today,
 * yesterday's makeup, and every past day) and a self-heal "ensure today's quiz
 * exists" used on load in case the 5:00 AM IST job hasn't run in this dev
 * process yet.
 */
import type { BilingualText, DailyQuizArchiveItem, TestKind } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istToday } from "../lib/ist.js";
import { getBestScoresByTest } from "./tests.js";
import { buildDailyQuiz } from "../daily/quiz.js";

export const DAILY_ARCHIVE_PAGE_SIZE = 20;

interface DailyQuizRow {
  id: string;
  slug: string | null;
  title_i18n: BilingualText;
  kind: TestKind;
  paper_code: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  scheduled_date: string;
  test_questions: { count: number }[];
}

function mapRow(row: DailyQuizRow, best: Map<string, { best: number; count: number }>): DailyQuizArchiveItem {
  return {
    id: row.id,
    slug: row.slug,
    title_i18n: row.title_i18n,
    kind: row.kind,
    paper_code: row.paper_code,
    duration_minutes: row.duration_minutes,
    total_marks: row.total_marks,
    question_count: row.test_questions[0]?.count ?? 0,
    best_score: best.get(row.id)?.best ?? null,
    attempts_count: best.get(row.id)?.count ?? 0,
    scheduled_date: row.scheduled_date,
  };
}

export async function listDailyQuizzes(
  page: number,
): Promise<{ items: DailyQuizArchiveItem[]; total: number }> {
  const from = (page - 1) * DAILY_ARCHIVE_PAGE_SIZE;
  const to = from + DAILY_ARCHIVE_PAGE_SIZE - 1;
  const { data, error, count } = await supabase()
    .from("tests")
    .select(
      "id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, scheduled_date, test_questions(count)",
      { count: "exact" },
    )
    .eq("kind", "daily_quiz")
    .eq("is_published", true)
    .not("scheduled_date", "is", null)
    .order("scheduled_date", { ascending: false })
    .range(from, to);
  if (error) throw new HttpError(500, `daily quiz archive query failed: ${error.message}`);

  const rows = (data ?? []) as unknown as DailyQuizRow[];
  const best = await getBestScoresByTest(rows.map((r) => r.id));
  return { items: rows.map((r) => mapRow(r, best)), total: count ?? 0 };
}

/**
 * Ensure today's daily quiz exists, building it on demand if the scheduled job
 * hasn't produced it yet (dev self-heal). Returns the test id, or null if there
 * were no questions to build from at all.
 */
export async function ensureTodayQuiz(userId: string): Promise<string | null> {
  const today = istToday();
  const { data: existing, error } = await supabase()
    .from("tests")
    .select("id")
    .eq("kind", "daily_quiz")
    .eq("scheduled_date", today)
    .maybeSingle();
  if (error) throw new HttpError(500, `daily quiz lookup failed: ${error.message}`);
  if (existing) return existing.id as string;

  const built = await buildDailyQuiz({ userId, date: today });
  return built?.test_id ?? null;
}
