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
 *
 * PER EXAM. Both sets are built for ONE exam and drawn from that exam's own
 * approved CA questions. A CA question's `exam_code` is not mere provenance the
 * way a PYQ's is — a CA question is GENERATED FOR one exam (ca/pipeline.ts), so
 * that column IS its owner, and it is the right filter here (the same one
 * `questionExamScopeFilter`'s current-affairs disjunct and the magazine's
 * `loadWorkbook`/`loadModelQuestions` already use). Without it a second exam's
 * weekly quiz drew from the live exam's entire CA bank.
 *
 * The slug carries the exam for a non-default exam (`ca-prelims-w2951:upsc`),
 * exactly as the daily quiz does (daily/quiz.ts) — the DEFAULT exam keeps its
 * historical bare slug so the existing weekly rows are not orphaned. The slug is
 * the idempotency key, so without this a second exam's build would find the live
 * exam's row and return it as if it were its own.
 *
 * CUTOFF BASIS (investigated, deliberately NOT changed): the pool is filtered
 * by the question's `created_at`, not by when it was approved. This was
 * investigated after a hypothesis that a late approval could silently exclude
 * a freshly-approved-but-old-generated item — live data showed that mechanism
 * doesn't actually occur (approval lag was consistently under a day, never
 * close to `days`); the real failure mode is that review happens in
 * infrequent bursts, so the approved pool can go stale between bursts.
 * Switching the basis to an approval timestamp would make that WORSE (it
 * would let genuinely old news back into "this week's" quiz whenever review
 * lags), so instead: if the pool at `days` is too thin, widen the window
 * once rather than redefining what "recent" means.
 */
import { DEFAULT_EXAM_CODE, type BilingualText, type TestSummary } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { liveExamCodes } from "../lib/exams.js";
import { roundMarks } from "../lib/marks.js";
import { HttpError } from "../lib/http-error.js";
import { CURRENT_AFFAIRS_PAPER_CODE, questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { daysBetween, istToday } from "../lib/ist.js";
import { selectAll } from "../lib/paginate.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear, type OwnWeightage } from "../lib/weightage.js";
import { getTestDetail } from "../services/tests.js";

const PRELIMS_MAX = 20;
const MAINS_MAX = 5;

/**
 * Ranking constants, mirroring the magazine curation's importance score
 * (services/magazine-curation.ts): a whole relevance tier dominates, and
 * syllabus weightage (recency-weighted PYQ hotness) ranks items WITHIN a tier
 * — capped so a many-node item can't jump a relevance tier. Applied to BOTH
 * weekly sets so each is the top-ranked slice of its pool, not a random slice.
 */
const REL_TIER = 1000;
const WEIGHT_CAP = 400;
/** Descriptive CA questions are all generated at mains_relevance === 3 (the pipeline's gate), so relevance is uniform among them and weightage is the differentiator. */
const DESCRIPTIVE_RELEVANCE = 3;
/** MCQs come from prelims_relevance >= 2 items; default a missing reverse-link to the gate minimum. */
const PRELIMS_RELEVANCE_FLOOR = 2;

/** Below this many approved questions at the normal cutoff, fall back to a wider window rather than ship a thin/empty quiz. */
const MIN_POOL: Record<"mcq" | "descriptive", number> = { mcq: 10, descriptive: 3 };
/** The wider fallback window, only used when the normal `days` pool is too thin. */
const FALLBACK_DAYS = 14;

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

/**
 * The week's slug for one exam. The DEFAULT exam keeps the historical bare form
 * so the weekly rows already in the table stay addressable; any other exam is
 * suffixed, which is what makes `tests.slug`'s global uniqueness a PER-EXAM
 * idempotency key rather than a cross-exam collision. Same convention as
 * daily/quiz.ts.
 */
function weeklySlug(base: string, examCode: string): string {
  return examCode === DEFAULT_EXAM_CODE ? base : `${base}:${examCode}`;
}

/**
 * `examCode` is required, not decorative: it makes a foreign-exam row
 * unreturnable even if a slug ever collided, so a lookup can never hand another
 * exam's test to `getTestDetail` (which would then 404 the whole endpoint
 * rather than report an honest empty state).
 */
async function findTestIdBySlug(slug: string, examCode: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from("tests")
    .select("id")
    .eq("slug", slug)
    .eq("exam_code", examCode)
    .maybeSingle();
  if (error) throw new HttpError(500, `weekly set lookup failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

interface CaPoolQ {
  id: string;
  marks: number | null;
  syllabus_node_id: string | null;
}

/** Approved CA questions of the given type, for ONE exam, dated within the last `days` days. */
async function approvedCaQuestionIds(
  type: "mcq" | "descriptive",
  days: number,
  examCode: string,
): Promise<CaPoolQ[]> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // Paged: the 14-day fallback window already matches >1000 rows, so an
  // unranged select silently dropped approved questions from the quiz pool.
  //
  // `.eq("exam_code", examCode)` — see this module's header. Scoped by exam_code
  // rather than by paper code because every row here is already pinned to the
  // synthetic CURRENT_AFFAIRS paper, which belongs to no exam's syllabus; for a
  // CA question the generating exam is its owner.
  return await selectAll<CaPoolQ & { created_at: string }>(() =>
    supabase()
      .from("questions")
      .select("id, marks, syllabus_node_id, created_at")
      .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
      .eq("type", type)
      .eq("exam_code", examCode)
      .gte("created_at", cutoff)
      .or(questionVisibilityOrFilter("catalog"))
      .order("id", { ascending: true }),
  );
}

/**
 * question_id -> prelims_relevance, reverse-mapped from the source current-
 * affairs items' `mcq_question_ids` over the widest window a build might use.
 * (Descriptive CA questions carry no such reverse array and are uniformly
 * mains_relevance 3, so they need no equivalent — see DESCRIPTIVE_RELEVANCE.)
 */
async function prelimsRelevanceByQuestion(days: number, examCode: string): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // `.overlaps("exam_codes", …)` — the established "current affairs for MY exam"
  // idiom (services/current-affairs.ts, services/magazine.ts). A CA item is
  // deliberately ONE row shared across exams, so this is a membership test, not
  // equality. Scoping it keeps the relevance a question is ranked by sourced
  // from an item that is actually part of this exam's feed.
  const rows = await selectAll<{ mcq_question_ids: string[] | null; prelims_relevance: number | null }>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, mcq_question_ids, prelims_relevance")
      .eq("is_published", true)
      .overlaps("exam_codes", [examCode])
      .gte("date", cutoff)
      .order("id", { ascending: true }),
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const rel = r.prelims_relevance ?? PRELIMS_RELEVANCE_FLOOR;
    for (const qid of r.mcq_question_ids ?? []) out.set(qid, Math.max(out.get(qid) ?? 0, rel));
  }
  return out;
}

/**
 * Rank a CA pool by relevance tier (dominant) then rolled-up syllabus weightage
 * within the tier — the same importance ordering the magazine editions use — so
 * `.slice(0, max)` keeps the week's MOST exam-worthy questions rather than a
 * random subset. Applied identically to BOTH the prelims quiz and the mains set.
 */
export function rankCaPool(
  pool: CaPoolQ[],
  relevanceOf: (id: string) => number,
  weightage: Map<string, OwnWeightage>,
  year: number,
): CaPoolQ[] {
  return [...pool]
    .map((q) => {
      const hot = hotnessRaw(weightage.get(q.syllabus_node_id ?? "")?.byYear ?? new Map(), year);
      return { q, score: relevanceOf(q.id) * REL_TIER + Math.min(hot, WEIGHT_CAP) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.q);
}

interface AssembleSpec {
  slug: string;
  title: BilingualText;
  type: "mcq" | "descriptive";
  max: number;
  durationMinutes: number | null;
  metaSource: string;
}

async function assemble(
  spec: AssembleSpec,
  days: number,
  weightage: Map<string, OwnWeightage>,
  year: number,
  examCode: string,
): Promise<string | null> {
  const existing = await findTestIdBySlug(spec.slug, examCode);
  if (existing) return existing;

  let pool = await approvedCaQuestionIds(spec.type, days, examCode);
  let usedDays = days;
  const minPool = MIN_POOL[spec.type];
  if (pool.length < minPool && days < FALLBACK_DAYS) {
    const widerPool = await approvedCaQuestionIds(spec.type, FALLBACK_DAYS, examCode);
    if (widerPool.length > pool.length) {
      pool = widerPool;
      usedDays = FALLBACK_DAYS;
    }
  }
  // No approved supply for THIS exam — an honest null, never another exam's set.
  if (pool.length === 0) return null;

  // Relevance per question: prelims MCQs reverse-map to their source item's
  // prelims_relevance (loaded over the widest window a build might use, so it
  // covers a widened pool too); descriptive CA is uniformly mains_relevance 3.
  const relMap = spec.type === "mcq" ? await prelimsRelevanceByQuestion(FALLBACK_DAYS, examCode) : null;
  const relevanceOf = (id: string) => (relMap ? relMap.get(id) ?? PRELIMS_RELEVANCE_FLOOR : DESCRIPTIVE_RELEVANCE);

  // Rank the pool by relevance + weightage, then cap — for BOTH sets. Shuffle
  // first so equal-relevance/equal-weightage ties vary across weeks.
  const selected = rankCaPool(shuffled(pool), relevanceOf, weightage, year).slice(0, spec.max);
  const totalMarks = roundMarks(selected.reduce((sum, q) => sum + (q.marks ?? 0), 0));

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      slug: spec.slug,
      title_i18n: spec.title,
      kind: "custom",
      // Stamped, never left on the column default — that default is 'uppsc'
      // (migration 0106 §5), so a second exam's weekly set would silently
      // become the live exam's and surface on its Current Affairs page.
      exam_code: examCode,
      paper_code: CURRENT_AFFAIRS_PAPER_CODE,
      duration_minutes: spec.durationMinutes,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source: spec.metaSource, days: usedDays, requested_days: days, widened: usedDays !== days },
    })
    .select("id")
    .single();
  if (testError) {
    // A concurrent cron tick may have created the same slug — converge on it.
    if (testError.code === "23505") return findTestIdBySlug(spec.slug, examCode);
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
  examCode: string;
  prelimsTestId: string | null;
  mainsTestId: string | null;
}

/**
 * Build (or return the existing) weekly Prelims Quiz + Mains Set for ONE exam.
 * `examCode` is REQUIRED — a defaulted exam is exactly what kept this pipeline
 * pinned to the live exam while looking parameterised (M24).
 */
export async function assembleWeeklySetsForExam(examCode: string, days = 7): Promise<WeeklyAssemblyResult> {
  const week = istWeekNumber();
  // Load the weightage matview once and rank BOTH sets against it. Deliberately
  // UNSCOPED: it is keyed by node id, and node ids are globally unique per exam,
  // so a lookup already returns only this exam's nodes. Passing an exam here
  // would instead drop the provenance rows (up_ro_aro, upsssc_pet) that
  // legitimately count toward the default exam's weightage, changing the live
  // exam's ranking for no gain.
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  const prelimsTestId = await assemble(
    {
      slug: weeklySlug(`ca-prelims-w${week}`, examCode),
      title: { en: "CA Prelims Quiz — This Week", hi: "करेंट अफेयर्स प्रीलिम्स क्विज़ — इस सप्ताह" },
      type: "mcq",
      max: PRELIMS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_prelims",
    },
    days,
    weightage,
    year,
    examCode,
  );
  const mainsTestId = await assemble(
    {
      slug: weeklySlug(`ca-mains-w${week}`, examCode),
      title: { en: "CA Mains Set — This Week", hi: "करेंट अफेयर्स मेन्स सेट — इस सप्ताह" },
      type: "descriptive",
      max: MAINS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_mains",
    },
    days,
    weightage,
    year,
    examCode,
  );
  return { week, examCode, prelimsTestId, mainsTestId };
}

export interface WeeklyAssemblyRun {
  week: number;
  results: WeeklyAssemblyResult[];
}

/**
 * THE EXAM-SELECTION BOUNDARY. Builds this IST week's two sittings for every
 * named exam, defaulting to every LIVE exam.
 *
 * The default is resolved from the registry, NOT from `DEFAULT_EXAM_CODE` — the
 * distinction M24 is about. A scheduled run must build for whoever can actually
 * see the result and must never inherit a pre-launch `--exam` override, which is
 * the same policy `ca/scheduler.ts` states for the pipeline tick. Measured today
 * the live set is exactly ["uppsc"], so the cron does what it always did.
 *
 * Kept callable with no arguments so the dev scheduler's `assembleWeeklySets()`
 * needs no change; every function below it takes a REQUIRED `examCode`.
 */
export async function assembleWeeklySets(
  opts: { days?: number; examCodes?: string[] } = {},
): Promise<WeeklyAssemblyRun> {
  const days = opts.days ?? 7;
  const examCodes = opts.examCodes ?? (await liveExamCodes());
  const results: WeeklyAssemblyResult[] = [];
  // Sequential: each exam's build loads the same weightage matview and hits the
  // same tables; there is at most a handful of exams and no reason to fan out.
  for (const examCode of examCodes) {
    results.push(await assembleWeeklySetsForExam(examCode, days));
  }
  return { week: istWeekNumber(), results };
}

/**
 * The current week's two sets for ONE exam as TestSummaries (null when that exam
 * has no approved supply yet).
 *
 * `examCode` is REQUIRED. Without it this returned the DEFAULT exam's sets to
 * every reader — and because `getTestDetail` refuses a test belonging to another
 * exam, a second exam's reader got a 404 on the whole endpoint instead of the
 * honest empty state this now returns.
 */
export async function getWeeklyCaSets(
  examCode: string,
): Promise<{ prelims: TestSummary | null; mains: TestSummary | null }> {
  const week = istWeekNumber();
  const [prelimsId, mainsId] = await Promise.all([
    findTestIdBySlug(weeklySlug(`ca-prelims-w${week}`, examCode), examCode),
    findTestIdBySlug(weeklySlug(`ca-mains-w${week}`, examCode), examCode),
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
