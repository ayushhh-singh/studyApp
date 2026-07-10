/**
 * Weekly current-affairs assemblies (the cron-built, curated sitting):
 *   - "CA Prelims Quiz" — up to 20 approved CA MCQs from the last N days.
 *   - "CA Mains Set"    — 3-5 approved CA descriptive questions.
 *
 * Both are ordinary published `tests` (kind='custom', paper_code=CURRENT_AFFAIRS,
 * so they stay out of the regular Practice/Answers tabs — listTests excludes
 * that paper code — and surface only through the Current Affairs page's two
 * quiz buttons / the Answers CA card). Idempotent per IST week via `slug`:
 * re-running the cron returns the same week's test rather than piling up dupes.
 *
 * Supply is APPROVED-only (questionVisibilityOrFilter("catalog")): the pipeline
 * inserts CA questions as review-gated (needs_review), and a human approves them
 * in the Review Queue's CA / descriptive tabs before they enter a weekly set.
 * Either set is null until there's approved supply.
 */
import type { BilingualText, TestSummary } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { CURRENT_AFFAIRS_PAPER_CODE, questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { daysBetween, istToday } from "../lib/ist.js";
import { getTestDetail } from "../services/tests.js";

const PRELIMS_MAX = 20;
const MAINS_MAX = 5;

/** Monotonic IST-week number (same convention as the daily answer set). */
export function istWeekNumber(date: string = istToday()): number {
  return Math.floor(daysBetween("1970-01-01", date) / 7);
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function findTestIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase().from("tests").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new HttpError(500, `weekly set lookup failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

/** Approved CA questions of the given type dated within the last `days` days. */
async function approvedCaQuestionIds(type: "mcq" | "descriptive", days: number): Promise<{ id: string; marks: number | null }[]> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase()
    .from("questions")
    .select("id, marks, created_at")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
    .eq("type", type)
    .gte("created_at", cutoff)
    .or(questionVisibilityOrFilter("catalog"));
  if (error) throw new HttpError(500, `approved CA question lookup failed: ${error.message}`);
  return (data ?? []) as { id: string; marks: number | null }[];
}

interface AssembleSpec {
  slug: string;
  title: BilingualText;
  type: "mcq" | "descriptive";
  max: number;
  durationMinutes: number | null;
  metaSource: string;
}

async function assemble(spec: AssembleSpec, days: number): Promise<string | null> {
  const existing = await findTestIdBySlug(spec.slug);
  if (existing) return existing;

  const pool = await approvedCaQuestionIds(spec.type, days);
  if (pool.length === 0) return null;

  const selected = shuffled(pool).slice(0, spec.max);
  const totalMarks = selected.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      slug: spec.slug,
      title_i18n: spec.title,
      kind: "custom",
      paper_code: CURRENT_AFFAIRS_PAPER_CODE,
      duration_minutes: spec.durationMinutes,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source: spec.metaSource, days },
    })
    .select("id")
    .single();
  if (testError) {
    // A concurrent cron tick may have created the same slug — converge on it.
    if (testError.code === "23505") return findTestIdBySlug(spec.slug);
    throw new HttpError(500, `weekly set insert failed: ${testError.message}`);
  }

  const { error: tqError } = await supabase()
    .from("test_questions")
    .insert(
      selected.map((q, index) => ({
        test_id: test.id as string,
        question_id: q.id,
        order_index: index,
        marks: q.marks,
      })),
    );
  if (tqError) {
    await supabase().from("tests").delete().eq("id", test.id as string);
    throw new HttpError(500, `weekly set questions insert failed: ${tqError.message}`);
  }
  return test.id as string;
}

export interface WeeklyAssemblyResult {
  week: number;
  prelimsTestId: string | null;
  mainsTestId: string | null;
}

/** Build (or return the existing) weekly Prelims Quiz + Mains Set for the current IST week. */
export async function assembleWeeklySets(days = 7): Promise<WeeklyAssemblyResult> {
  const week = istWeekNumber();
  const prelimsTestId = await assemble(
    {
      slug: `ca-prelims-w${week}`,
      title: { en: "CA Prelims Quiz — This Week", hi: "करेंट अफेयर्स प्रीलिम्स क्विज़ — इस सप्ताह" },
      type: "mcq",
      max: PRELIMS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_prelims",
    },
    days,
  );
  const mainsTestId = await assemble(
    {
      slug: `ca-mains-w${week}`,
      title: { en: "CA Mains Set — This Week", hi: "करेंट अफेयर्स मेन्स सेट — इस सप्ताह" },
      type: "descriptive",
      max: MAINS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_mains",
    },
    days,
  );
  return { week, prelimsTestId, mainsTestId };
}

/** The current week's two sets as TestSummaries (null when there's no approved supply yet). */
export async function getWeeklyCaSets(): Promise<{ prelims: TestSummary | null; mains: TestSummary | null }> {
  const week = istWeekNumber();
  const [prelimsId, mainsId] = await Promise.all([
    findTestIdBySlug(`ca-prelims-w${week}`),
    findTestIdBySlug(`ca-mains-w${week}`),
  ]);
  const toSummary = async (id: string | null): Promise<TestSummary | null> => {
    if (!id) return null;
    const detail = await getTestDetail(id);
    // TestDetail extends TestSummary — strip the questions array for the summary view.
    const { questions: _questions, marking_scheme: _ms, ...summary } = detail;
    return summary as TestSummary;
  };
  const [prelims, mains] = await Promise.all([toSummary(prelimsId), toSummary(mainsId)]);
  return { prelims, mains };
}
