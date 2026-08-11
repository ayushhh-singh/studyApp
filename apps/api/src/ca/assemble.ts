/**
 * Cron-built current-affairs sittings, at TWO cadences.
 *
 * WEEKLY (the curated sitting, built by `ca:assemble` every MONDAY):
 *   - "CA Prelims Quiz" — up to 50 approved CA MCQs from the last N days.
 *   - "CA Mains Set"    — up to 20 approved CA descriptive questions.
 *
 *   ⚑ THE WEEK IS MONDAY-ANCHORED, and that alignment is load-bearing. The week
 *   used to be `floor(daysBetween("1970-01-01", date) / 7)` — and because the
 *   epoch was a THURSDAY, the week number rolled over mid-week while the cron
 *   built on Monday. So the freshly built set became unreachable every Thursday
 *   and the Current Affairs page showed "No prelims quiz yet this week" for FOUR
 *   DAYS OUT OF SEVEN. It now keys off `istWeekStart` (lib/ist.ts), the one
 *   Monday-anchored week definition in this codebase, which the scoreboard's
 *   weekly boards already used — so the boundary and the build day coincide and
 *   the set is live for the whole week it is labelled for.
 *
 * DAILY (the quick daily hit, built alongside the GS/CSAT daily quiz by
 * `daily:build` — see `assembleDailyCaSets` at the bottom of this file):
 *   - "CA Prelims Quiz — Today" — up to 15 MCQs approved in the last day.
 *   - "CA Mains Set — Today"    — up to 5 descriptive questions, same window.
 *
 * The two cadences deliberately share every mechanism below (pool query,
 * relevance+weightage ranking, slug idempotency, per-exam scoping) and differ
 * only in parameters, each with its reason recorded at its definition: window
 * size (`DAILY_DAYS`) and set size (`DAILY_*_MAX`), plus two behaviours the
 * weekly set has that a daily one must NOT — pool widening (`widenWhenThin`)
 * and un-deduplicated reuse (`DAILY_RECENCY_DAYS`). The daily window is also
 * anchored to the DAY BEING BUILT rather than to the clock, so a
 * `daily:build --date <past-date>` rebuild is honest; see `dayWindow`.
 *
 * All four are ordinary published `tests` (kind='custom', paper_code=CURRENT_AFFAIRS,
 * so they stay out of the regular Practice/Answers tabs — listTests excludes
 * that paper code — and surface only through the Current Affairs page's
 * quiz buttons / the Answers CA card). Idempotent per IST period via `slug`:
 * re-running either cron returns that period's existing test rather than piling
 * up dupes.
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
 * The slug carries the exam for a non-default exam (`ca-prelims-w2026-08-10:upsc`,
 * `ca-prelims-d2026-08-08:upsc`), exactly as the daily quiz does
 * (daily/quiz.ts) — the DEFAULT exam keeps its historical bare slug so the
 * existing weekly rows are not orphaned. The slug is the idempotency key, so
 * without this a second exam's build would find the live exam's row and return
 * it as if it were its own.
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
import { istToday, istWeekStart, shiftDate } from "../lib/ist.js";
import { selectAll } from "../lib/paginate.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear, type OwnWeightage } from "../lib/weightage.js";
import { getTestDetail } from "../services/tests.js";

const PRELIMS_MAX = 50;
const MAINS_MAX = 20;

/**
 * The daily sitting stays a fraction of the weekly one: a quick hit on what was
 * approved since yesterday, not a second full sitting.
 *
 * SUPPLY REALITY, measured rather than assumed — approved CA MCQs run ~50-125
 * per day while the pipeline is running, so the prelims cap fills easily. Approved
 * DESCRIPTIVE runs only ~1-6 per day, so the mains cap is an upper bound the
 * supply frequently cannot reach; a short mains set is the honest result, not a
 * fault. See `docs`-free note on the exclusion interaction at DAILY_RECENCY_DAYS.
 */
const DAILY_PRELIMS_MAX = 15;
const DAILY_MAINS_MAX = 5;

/**
 * The daily window, in days back from the day being built — so the pool is
 * `[date - 1, date + 1)`, i.e. yesterday's and today's questions, NOT strictly
 * "today's". That slack is deliberate: a question approved late on day D would
 * otherwise fall between two builds and never appear in any daily set at all.
 *
 * The cost of the slack is that consecutive days see an overlapping pool, which
 * is exactly what DAILY_RECENCY_DAYS below exists to neutralise.
 */
const DAILY_DAYS = 1;

/**
 * How many previous days' daily CA sets to exclude from today's pool, so the
 * overlap the window deliberately allows never becomes a REPEATED QUIZ. Without
 * this, a question created on day D lands in both day D's and day D+1's set and
 * a user doing the daily quiz two days running sees the same items.
 *
 * Comfortably wider than the ~2-day window it de-duplicates. When the exclusion
 * empties the pool (nothing new approved since yesterday) the honest outcome is
 * NO daily set for that day — never yesterday's questions re-served as today's.
 */
const DAILY_RECENCY_DAYS = 3;

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

/**
 * How many previous weeks' sets to exclude from a new weekly build.
 *
 * A non-widened 7-day window cannot overlap the previous week's, but the
 * FALLBACK_DAYS widening reaches back 14 days -- so two consecutive thin weeks
 * would otherwise serve substantially the same questions. Two weeks covers the
 * widest window a build can use.
 */
const WEEKLY_RECENCY_WEEKS = 2;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A period's slug for one exam — shared by BOTH cadences
 * (`ca-prelims-w2026-08-10` where the date is the week's MONDAY, and
 * `ca-prelims-d2026-08-08`). The DEFAULT exam keeps the historical bare form so
 * the weekly rows already in the table stay addressable; any other exam is
 * suffixed, which is what makes `tests.slug`'s global uniqueness a PER-EXAM
 * idempotency key rather than a cross-exam collision. Same convention as
 * daily/quiz.ts.
 */
function scopedSlug(base: string, examCode: string): string {
  return examCode === DEFAULT_EXAM_CODE ? base : `${base}:${examCode}`;
}

/** The four period slugs, in one place so the builder and the reader cannot drift apart. */
const weeklyBase = (kind: "prelims" | "mains", weekStart: string) => `ca-${kind}-w${weekStart}`;
const dailyBase = (kind: "prelims" | "mains", date: string) => `ca-${kind}-d${date}`;

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
  if (error) throw new HttpError(500, `CA set lookup failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

interface CaPoolQ {
  id: string;
  marks: number | null;
  syllabus_node_id: string | null;
}

/**
 * The `created_at` window a build draws from.
 *
 * `from` is inclusive, `to` exclusive and optional. Both are date-only strings,
 * matching the convention this query has always used — an approximation of the
 * IST day (they compare against UTC midnight), kept as-is so the weekly pool is
 * unchanged; the daily cadence inherits the same precision.
 */
interface PoolWindow {
  from: string;
  to?: string;
}

/**
 * The window for a NAMED IST day: `[date - days, date + 1)`.
 *
 * BOTH cadences anchor to the period they are BUILDING, never to the clock.
 * That matters because the slug is period-keyed while the pool used to be
 * clock-relative, so building a past period filed TODAY's questions under that
 * period's slug — silently, since the row looks perfectly well-formed. Anchoring
 * makes `daily:build --date <past-date>` honest, and makes a weekly set depend
 * only on WHICH week it is, not on which day of that week the cron happened to
 * run (so a Monday build and a Wednesday recovery build produce the same set).
 *
 * When the period is the current one this is equivalent to a trailing window —
 * `to` is tomorrow, and nothing is created in the future — which is why the
 * production path is unaffected by having an upper bound at all.
 */
function dayWindow(date: string, days: number): PoolWindow {
  return { from: shiftDate(date, -days), to: shiftDate(date, 1) };
}

/** Approved CA questions of the given type, for ONE exam, created within `window`. */
async function approvedCaQuestionIds(
  type: "mcq" | "descriptive",
  window: PoolWindow,
  examCode: string,
): Promise<CaPoolQ[]> {
  // Paged: the 14-day fallback window already matches >1000 rows, so an
  // unranged select silently dropped approved questions from the quiz pool.
  //
  // `.eq("exam_code", examCode)` — see this module's header. Scoped by exam_code
  // rather than by paper code because every row here is already pinned to the
  // synthetic CURRENT_AFFAIRS paper, which belongs to no exam's syllabus; for a
  // CA question the generating exam is its owner.
  return await selectAll<CaPoolQ & { created_at: string }>(() => {
    let q = supabase()
      .from("questions")
      .select("id, marks, syllabus_node_id, created_at")
      .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
      .eq("type", type)
      .eq("exam_code", examCode)
      .gte("created_at", window.from);
    if (window.to) q = q.lt("created_at", window.to);
    return q.or(questionVisibilityOrFilter("catalog")).order("id", { ascending: true });
  });
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
  /**
   * Widen to FALLBACK_DAYS when the pool at `days` is thin. TRUE for the weekly
   * sitting (a thin week is better served by slightly older news than by an
   * empty quiz) and FALSE for the daily one, where it would be actively wrong:
   * it would put two-week-old items in a set titled "Today", and because the
   * widened pool barely moves day to day it would make consecutive daily sets
   * near-identical — the precise failure `excludeIds` exists to prevent.
   */
  widenWhenThin: boolean;
  /**
   * Questions to drop before ranking (the daily cadence's anti-repetition set).
   * Applied to the POOL rather than to the selection so the set still fills to
   * `max` from whatever is genuinely fresh, instead of shrinking by however many
   * of its top-ranked items happened to be seen recently.
   */
  excludeIds?: ReadonlySet<string>;
  /**
   * The pool's `created_at` window. The weekly cadence passes a clock-relative
   * one; the daily cadence passes the window for the IST day it is building, so
   * a `--date` rebuild draws that day's questions rather than today's.
   */
  window: PoolWindow;
  /** Only used to widen `window`, and only when `widenWhenThin` — see below. */
  widerWindow?: PoolWindow;
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

  let pool = await approvedCaQuestionIds(spec.type, spec.window, examCode);
  let usedDays = days;
  const minPool = MIN_POOL[spec.type];
  if (spec.widenWhenThin && spec.widerWindow && pool.length < minPool && days < FALLBACK_DAYS) {
    const widerPool = await approvedCaQuestionIds(spec.type, spec.widerWindow, examCode);
    if (widerPool.length > pool.length) {
      pool = widerPool;
      usedDays = FALLBACK_DAYS;
    }
  }
  const excluded = spec.excludeIds;
  if (excluded?.size) pool = pool.filter((q) => !excluded.has(q.id));
  // No approved supply for THIS exam — an honest null, never another exam's set.
  // For the daily cadence this is also the "nothing new since yesterday" case:
  // no set for today is correct, re-serving yesterday's questions is not.
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
    throw new HttpError(500, `CA set insert failed (${spec.slug}): ${testError.message}`);
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
    throw new HttpError(500, `CA set questions insert failed (${spec.slug}): ${tqError.message}`);
  }
  return test.id as string;
}

export interface WeeklyAssemblyResult {
  /** The MONDAY of the ISO week this set belongs to (`YYYY-MM-DD`). */
  weekStart: string;
  examCode: string;
  prelimsTestId: string | null;
  mainsTestId: string | null;
}

/**
 * Build (or return the existing) weekly Prelims Quiz + Mains Set for ONE exam.
 * `examCode` is REQUIRED — a defaulted exam is exactly what kept this pipeline
 * pinned to the live exam while looking parameterised (M24).
 */
export async function assembleWeeklySetsForExam(
  examCode: string,
  days = 7,
  weekStart: string = istWeekStart(istToday()),
): Promise<WeeklyAssemblyResult> {
  // Load the weightage matview once and rank BOTH sets against it. Deliberately
  // UNSCOPED: it is keyed by node id, and node ids are globally unique per exam,
  // so a lookup already returns only this exam's nodes. Passing an exam here
  // would instead drop the provenance rows (up_ro_aro, upsssc_pet) that
  // legitimately count toward the default exam's weightage, changing the live
  // exam's ranking for no gain.
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  // Anti-repetition across consecutive weeks -- see WEEKLY_RECENCY_WEEKS. NOT
  // extended to the DAILY sets of the same week: that overlap is deliberate.
  // The weekly sitting is a consolidation of the week, so re-meeting an item a
  // few days after the daily quiz is spaced revision, not a bug -- and
  // excluding them would strip a week of daily picks from a pool capped at 50.
  const [seenPrelims, seenMains] = await Promise.all([
    recentCaQuestionIds(precedingWeeklyBases("prelims", weekStart), examCode),
    recentCaQuestionIds(precedingWeeklyBases("mains", weekStart), examCode),
  ]);
  const prelimsTestId = await assemble(
    {
      slug: scopedSlug(weeklyBase("prelims", weekStart), examCode),
      title: { en: "CA Prelims Quiz — This Week", hi: "करेंट अफेयर्स प्रीलिम्स क्विज़ — इस सप्ताह" },
      type: "mcq",
      max: PRELIMS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_prelims",
      widenWhenThin: true,
      window: dayWindow(weekStart, days),
      widerWindow: dayWindow(weekStart, FALLBACK_DAYS),
      excludeIds: seenPrelims,
    },
    days,
    weightage,
    year,
    examCode,
  );
  const mainsTestId = await assemble(
    {
      slug: scopedSlug(weeklyBase("mains", weekStart), examCode),
      title: { en: "CA Mains Set — This Week", hi: "करेंट अफेयर्स मेन्स सेट — इस सप्ताह" },
      type: "descriptive",
      max: MAINS_MAX,
      durationMinutes: null,
      metaSource: "ca_weekly_mains",
      widenWhenThin: true,
      window: dayWindow(weekStart, days),
      widerWindow: dayWindow(weekStart, FALLBACK_DAYS),
      excludeIds: seenMains,
    },
    days,
    weightage,
    year,
    examCode,
  );
  return { weekStart, examCode, prelimsTestId, mainsTestId };
}

export interface WeeklyAssemblyRun {
  weekStart: string;
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
  const weekStart = istWeekStart(istToday());
  const examCodes = opts.examCodes ?? (await liveExamCodes());
  const results: WeeklyAssemblyResult[] = [];
  // Sequential: each exam's build loads the same weightage matview and hits the
  // same tables; there is at most a handful of exams and no reason to fan out.
  for (const examCode of examCodes) {
    results.push(await assembleWeeklySetsForExam(examCode, days, weekStart));
  }
  return { weekStart, results };
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
  const weekStart = istWeekStart(istToday());
  const [prelimsId, mainsId] = await Promise.all([
    findTestIdBySlug(scopedSlug(weeklyBase("prelims", weekStart), examCode), examCode),
    findTestIdBySlug(scopedSlug(weeklyBase("mains", weekStart), examCode), examCode),
  ]);
  return summarisePair(prelimsId, mainsId);
}

/** Shared by both readers: two test ids -> two TestSummaries (null passes through). */
async function summarisePair(
  prelimsId: string | null,
  mainsId: string | null,
): Promise<{ prelims: TestSummary | null; mains: TestSummary | null }> {
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

// ---------------------------------------------------------------------------
// DAILY cadence. Everything above is shared; only the three parameters named in
// this module's header differ. Built by `daily:build` (daily/run.ts) so the two
// daily cadences — the GS/CSAT quiz and this — run in ONE coordinated job
// rather than two crons that can disagree about what "today" is.
// ---------------------------------------------------------------------------

/**
 * Every question used by the `count` preceding periods' CA sets of this kind,
 * for THIS exam — the anti-repetition set, shared by both cadences.
 *
 * Looked up by RECONSTRUCTING those periods' slugs rather than by scanning
 * `tests.meta->>source` over a date range: the slugs are deterministic, so this
 * is an exact `.in()` on a unique-indexed column with no dependence on a
 * timestamp column these rows do not set (`scheduled_date` is a daily_quiz
 * concept; these are kind='custom'). Same shape as daily/quiz.ts's
 * `recentlyUsedInDailyQuiz`, and exam-scoped for the same reason recorded there:
 * without it one exam's set suppresses questions another exam's candidates have
 * never seen.
 */
async function recentCaQuestionIds(
  bases: string[],
  examCode: string,
): Promise<Set<string>> {
  const slugs = bases.map((b) => scopedSlug(b, examCode));
  const { data: tests, error: tErr } = await supabase()
    .from("tests")
    .select("id")
    .eq("exam_code", examCode)
    .in("slug", slugs);
  if (tErr) throw new HttpError(500, `recent CA sets lookup failed: ${tErr.message}`);
  const testIds = (tests ?? []).map((r) => r.id as string);
  if (testIds.length === 0) return new Set();
  // Bounded by the recency depth x the per-set cap (at most 2 weeks x 50 = 100
  // rows), far below PostgREST's 1000-row cap, so this needs no paging.
  const { data, error } = await supabase().from("test_questions").select("question_id").in("test_id", testIds);
  if (error) throw new HttpError(500, `recent CA questions lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.question_id as string));
}

/** The preceding `DAILY_RECENCY_DAYS` days' daily slugs, for `kind`. */
function precedingDailyBases(kind: "prelims" | "mains", date: string): string[] {
  return Array.from({ length: DAILY_RECENCY_DAYS }, (_, i) => dailyBase(kind, shiftDate(date, -(i + 1))));
}

/** The preceding `WEEKLY_RECENCY_WEEKS` weeks' weekly slugs, for `kind`. */
function precedingWeeklyBases(kind: "prelims" | "mains", weekStart: string): string[] {
  return Array.from({ length: WEEKLY_RECENCY_WEEKS }, (_, i) => weeklyBase(kind, shiftDate(weekStart, -7 * (i + 1))));
}

export interface DailyAssemblyResult {
  date: string;
  examCode: string;
  prelimsTestId: string | null;
  mainsTestId: string | null;
}

/**
 * Build (or return the existing) daily Prelims Quiz + Mains Set for ONE exam.
 * `examCode` is REQUIRED for the same reason as the weekly builder's (M24).
 */
export async function assembleDailyCaSetsForExam(
  examCode: string,
  date: string = istToday(),
): Promise<DailyAssemblyResult> {
  // Unscoped for the reason recorded on the weekly builder: keyed by node id,
  // which is already globally unique per exam.
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  const [seenPrelims, seenMains] = await Promise.all([
    recentCaQuestionIds(precedingDailyBases("prelims", date), examCode),
    recentCaQuestionIds(precedingDailyBases("mains", date), examCode),
  ]);
  const prelimsTestId = await assemble(
    {
      slug: scopedSlug(dailyBase("prelims", date), examCode),
      title: { en: "CA Prelims Quiz — Today", hi: "करेंट अफेयर्स प्रीलिम्स क्विज़ — आज" },
      type: "mcq",
      max: DAILY_PRELIMS_MAX,
      durationMinutes: null,
      metaSource: "ca_daily_prelims",
      widenWhenThin: false,
      excludeIds: seenPrelims,
      window: dayWindow(date, DAILY_DAYS),
    },
    DAILY_DAYS,
    weightage,
    year,
    examCode,
  );
  const mainsTestId = await assemble(
    {
      slug: scopedSlug(dailyBase("mains", date), examCode),
      title: { en: "CA Mains Set — Today", hi: "करेंट अफेयर्स मेन्स सेट — आज" },
      type: "descriptive",
      max: DAILY_MAINS_MAX,
      durationMinutes: null,
      metaSource: "ca_daily_mains",
      widenWhenThin: false,
      excludeIds: seenMains,
      window: dayWindow(date, DAILY_DAYS),
    },
    DAILY_DAYS,
    weightage,
    year,
    examCode,
  );
  return { date, examCode, prelimsTestId, mainsTestId };
}

export interface DailyAssemblyRun {
  date: string;
  results: DailyAssemblyResult[];
}

/**
 * THE EXAM-SELECTION BOUNDARY for the daily cadence — but unlike the weekly one
 * it does NOT resolve its own default. `examCodes` is REQUIRED because the
 * caller is `runDailyBuild`, which has already resolved the exam set through
 * `resolveDailyBuildExams` (live exams, or an explicit `--exam` that may name a
 * pre-launch exam on purpose). Resolving again here would let the daily CA sets
 * silently cover a DIFFERENT exam set than the GS/CSAT quizzes built beside them
 * in the same run — which is the whole reason this is one job and not two crons.
 */
export async function assembleDailyCaSets(opts: {
  date?: string;
  examCodes: string[];
}): Promise<DailyAssemblyRun> {
  const date = opts.date ?? istToday();
  const results: DailyAssemblyResult[] = [];
  // Sequential, matching the weekly builder: a handful of exams, each loading
  // the same weightage matview and hitting the same tables.
  for (const examCode of opts.examCodes) {
    results.push(await assembleDailyCaSetsForExam(examCode, date));
  }
  return { date, results };
}

/**
 * Today's two CA sets for ONE exam as TestSummaries (null when that exam has no
 * fresh approved supply today). `examCode` is REQUIRED — see `getWeeklyCaSets`.
 */
export async function getDailyCaSets(
  examCode: string,
): Promise<{ prelims: TestSummary | null; mains: TestSummary | null }> {
  const date = istToday();
  const [prelimsId, mainsId] = await Promise.all([
    findTestIdBySlug(scopedSlug(dailyBase("prelims", date), examCode), examCode),
    findTestIdBySlug(scopedSlug(dailyBase("mains", date), examCode), examCode),
  ]);
  return summarisePair(prelimsId, mainsId);
}
