/**
 * Read side of the daily-engagement engine: the daily-quiz archive (today,
 * yesterday's makeup, and every past day) and a self-heal "ensure today's quiz
 * exists" used on load in case the 5:00 AM IST job hasn't run in this dev
 * process yet.
 */
import type { BilingualText, DailyQuizArchiveItem, DailyQuizzesToday, TestKind, TestSummary } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istToday } from "../lib/ist.js";
import { getBestScoresByTest } from "./tests.js";
import { buildDailyQuizVariant } from "../daily/quiz.js";
import { variantsForExam, type DailyQuizVariant } from "../daily/config.js";

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
    year: null,
    scheduled_date: row.scheduled_date,
  };
}

export async function listDailyQuizzes(
  examCode: string,
  page: number,
  /**
   * Restrict to one paper (the archive's GS/CSAT segmentation). Optional — the
   * unfiltered call is still the full mixed archive.
   *
   * FILTERING MUST BE SERVER-SIDE, not applied to a fetched page: a paper is a
   * SPARSE filter over a date-ordered list, so narrowing a 20-row page
   * client-side yields ragged pages (10 rows, then 12, then 8) and a page count
   * that describes the wrong list. UNTRUSTED (a query param), but it can only
   * ever narrow a result set already scoped by `exam_code` below, so a foreign
   * exam's paper code yields zero rows rather than another exam's quizzes.
   */
  paperCode?: string,
): Promise<{ items: DailyQuizArchiveItem[]; total: number }> {
  const from = (page - 1) * DAILY_ARCHIVE_PAGE_SIZE;
  const to = from + DAILY_ARCHIVE_PAGE_SIZE - 1;
  let query = supabase()
    .from("tests")
    .select(
      "id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, scheduled_date, test_questions(count)",
      { count: "exact" },
    )
    .eq("kind", "daily_quiz")
    .eq("exam_code", examCode)
    .eq("is_published", true)
    .not("scheduled_date", "is", null);
  if (paperCode) query = query.eq("paper_code", paperCode);
  const { data, error, count } = await query
    .order("scheduled_date", { ascending: false })
    .range(from, to);
  if (error) {
    // PGRST103 = the requested page starts past the end of the data. Not a
    // server fault: narrowing by paper shrinks the list under a page number the
    // client already holds. Same fix as listQuestions/listReviewQueue — re-count
    // with the identical filters (PostgREST leaves `count` null on this error)
    // and return an empty page rather than 500ing the whole archive.
    if (error.code === "PGRST103") {
      let countQuery = supabase()
        .from("tests")
        .select("id", { count: "exact", head: true })
        .eq("kind", "daily_quiz")
        .eq("exam_code", examCode)
        .eq("is_published", true)
        .not("scheduled_date", "is", null);
      if (paperCode) countQuery = countQuery.eq("paper_code", paperCode);
      const { count: total } = await countQuery;
      return { items: [], total: total ?? 0 };
    }
    throw new HttpError(500, `daily quiz archive query failed: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as DailyQuizRow[];
  const best = await getBestScoresByTest(rows.map((r) => r.id));
  return { items: rows.map((r) => mapRow(r, best)), total: count ?? 0 };
}

interface DailyQuizSummaryRow {
  id: string;
  slug: string | null;
  title_i18n: BilingualText;
  kind: TestKind;
  paper_code: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  test_questions: { count: number }[];
}

const DAILY_QUIZ_SUMMARY_COLUMNS =
  "id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, test_questions(count)";

function toSummary(row: DailyQuizSummaryRow, best: { best: number; count: number } | undefined): TestSummary {
  return {
    id: row.id,
    slug: row.slug,
    title_i18n: row.title_i18n,
    kind: row.kind,
    paper_code: row.paper_code,
    duration_minutes: row.duration_minutes,
    total_marks: row.total_marks,
    question_count: row.test_questions[0]?.count ?? 0,
    best_score: best?.best ?? null,
    attempts_count: best?.count ?? 0,
    year: null,
  };
}

/**
 * Find one variant's daily-quiz test row for a date (exam- + paper-scoped), or
 * null.
 *
 * The `exam_code` filter is what keeps `.maybeSingle()` safe. Paper codes are
 * globally unique across exams today (the §0 invariant), so two rows cannot
 * match — but this query would degrade WORSE than "returns the wrong row" if
 * that ever changed: PostgREST raises PGRST116 on multiple matches, which
 * surfaces as a 500 on the dashboard and Practice tab for everyone. Naming the
 * exam makes the single-row expectation true by construction rather than by
 * an invariant enforced two tables away.
 */
async function findDailyQuizRow(variant: DailyQuizVariant, date: string): Promise<DailyQuizSummaryRow | null> {
  const { data, error } = await supabase()
    .from("tests")
    .select(DAILY_QUIZ_SUMMARY_COLUMNS)
    .eq("kind", "daily_quiz")
    .eq("exam_code", variant.examCode)
    .eq("is_published", true)
    .eq("scheduled_date", date)
    .eq("paper_code", variant.paperCode)
    .maybeSingle();
  if (error) throw new HttpError(500, `daily quiz lookup failed: ${error.message}`);
  return (data as unknown as DailyQuizSummaryRow | null) ?? null;
}

/**
 * Ensure BOTH of today's daily quizzes (GS + CSAT) exist, building either on
 * demand if the 5:00 AM IST job hasn't produced it yet (self-heal). Each is one
 * shared test for the whole platform (see daily/quiz.ts's doc comment), so this
 * doesn't take a userId. Returns a summary per variant, or null for a variant
 * with genuinely no questions to build from.
 */
export async function ensureTodayQuizzes(examCode: string): Promise<DailyQuizzesToday> {
  const today = istToday();
  const out: DailyQuizzesToday = { gs: null, csat: null };
  // An exam with no configured variants yields {gs: null, csat: null} — the
  // same shape as "today's quiz couldn't be built", which the client already
  // renders as an empty state. Deliberately NOT falling back to the default
  // exam's variants: that would serve another exam's quiz and record the
  // attempt on its board.
  for (const variant of variantsForExam(examCode)) {
    let row = await findDailyQuizRow(variant, today);
    if (!row) {
      const built = await buildDailyQuizVariant(variant, { date: today });
      if (built) row = await findDailyQuizRow(variant, today);
    }
    if (!row) continue;
    const best = (await getBestScoresByTest([row.id])).get(row.id);
    out[variant.key] = toSummary(row, best);
  }
  return out;
}
