/**
 * Daily-quiz assembler. Each IST day carries TWO genuinely separate quizzes —
 * a GS quiz (paper PRE_GS1) and a CSAT quiz (paper PRE_CSAT) — assembled
 * INDEPENDENTLY, never blended. `buildDailyQuizVariant` composes one variant's
 * daily_quiz test by mixing four slices (generated-on-weak-topics, spaced PYQs,
 * this week's current-affairs MCQs, random coverage) — all drawn from that
 * variant's OWN paper pool — per its DailyQuizConfig; `buildDailyQuizzes` builds
 * both. See daily/config.ts for the per-paper sizes/ratios and the split's
 * rationale.
 *
 * Each variant's test is a single SHARED test, not per-user — `services/
 * scoreboard.ts` ranks every user's attempt on the GS quiz against each other
 * via `daily_quiz_board_entries`, which only makes sense if everyone took the
 * same set. So "weak topics"/"recently seen" below are platform-wide signals
 * (aggregated across all graded attempts / all past daily quizzes of THAT
 * paper), never any one individual's — there is no single "the user" for a quiz
 * everyone takes.
 *
 * Every pool query goes through `assemblyVisibilityOrFilter()` — published AND
 * review-approved, no exceptions, for all four slices. ⚑ The current-affairs
 * slice used to run the "test" scope, which admits anything on the
 * CURRENT_AFFAIRS paper code regardless of review state; measured 2026-08-13 that
 * had put 30 unapproved questions (mostly ones a human REJECTED) into 21 live
 * daily quizzes. See lib/question-visibility.ts for why that exception existed
 * and why it is serving-only now.
 *
 * TOPIC MIX is balanced across all four slices as ONE paper (lib/topic-balance.ts),
 * against the same recency-weighted section hotness the mock builder uses. The
 * slice ratios stay a content-type decision; the balancer decides which SECTION
 * each slice's next pick comes from, sharing one running tally so the slices
 * cannot each be individually reasonable and collectively skewed.
 *
 * Idempotent per (date, paper): keyed on slug `daily:YYYY-MM-DD:<paper>`; a
 * re-run rebuilds membership. Yesterday's quizzes simply remain published tests
 * (makeup), and the archive lists every past daily_quiz by scheduled_date.
 * Legacy pre-split quizzes (slug `daily:YYYY-MM-DD`, paper_code NULL) still
 * render exactly as before — nothing rewrites them.
 */
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { formatDateBilingual } from "../lib/ist.js";
import { assemblyVisibilityOrFilter } from "../lib/question-visibility.js";
import { DEFAULT_MCQ_MARKS, roundMarks } from "../lib/marks.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear } from "../lib/weightage.js";
import { sectionHotness, sectionOf, topLevelByNode, UNMAPPED_SECTION } from "../lib/sections.js";
import { balancedPick, maxSectionDeviationPct } from "../lib/topic-balance.js";
import {
  SLICE_FILL_ORDER,
  clampSize,
  sliceTargets,
  variantsForExam,
  type DailyQuizPaper,
  type DailyQuizVariant,
  type QuizSlice,
} from "./config.js";

type Log = (msg: string) => void;

interface PoolItem {
  id: string;
  marks: number;
  /**
   * Top-level syllabus section, so the four slices can be balanced against real
   * weightage as ONE paper rather than four independent draws — see
   * `selectDailyQuizItems`. `__unmapped__` for a question with no syllabus node.
   */
  top: string;
}

export interface DailyQuizBuildResult {
  test_id: string;
  date: string;
  /** Which paper this quiz is — 'gs' (PRE_GS1) or 'csat' (PRE_CSAT). */
  paper: DailyQuizPaper;
  size: number;
  total_marks: number;
  /** How many questions each slice actually contributed. */
  slice_breakdown: Record<QuizSlice, number>;
  /** Slices whose own pool couldn't meet their target (before backfill). */
  shortfalls: { slice: QuizSlice; target: number; filled: number }[];
  /** How many questions were pulled from other pools to hit `size`. */
  backfilled: number;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `syllabus_node_id` is what every pool item's section (`top`) is derived from. */
const MCQ_COLUMNS = "id, marks, syllabus_node_id";

/**
 * Every syllabus node id belonging to one exam. Paged — the tree is ~500 rows
 * across two exams today and grows with every syllabus ingest, and a truncated
 * read here would silently drop weak topics from the ranking rather than error.
 */
async function examSyllabusNodeIds(examCode: string): Promise<Set<string>> {
  const rows = await selectAll<{ id: string }>(() =>
    supabase().from("syllabus_nodes").select("id").eq("exam_code", examCode).order("id", { ascending: true }),
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Leaf topics the platform as a whole answers below `threshold` accuracy on,
 * returned in PRIORITY order — aggregated across every user's graded attempts,
 * not any one individual's (see the module doc comment: this is a shared quiz).
 *
 * Priority is a COMBINED weak-AND-heavily-tested score, not accuracy alone:
 * a topic that's weak AND asked often by UPPSC ranks above one that's equally
 * weak but rarely asked. Both signals are normalized to [0,1] and summed
 * (equal weight):
 *   weakness  = 1 - accuracy                       (higher = weaker)
 *   weightage = hotness / maxHotness               (recency-weighted PYQ freq)
 * This is a reordering, not a filter — every below-threshold topic is still
 * returned; the generated slice just serves the high-priority ones first.
 *
 * Paginated (selectAll) since attempt_answers is unbounded and PostgREST caps
 * a single select at 1000 rows.
 */
async function globalWeakNodeIds(threshold: number, examCode: string): Promise<string[]> {
  const [rows, weightage, examNodeIds] = await Promise.all([
    selectAll<{ is_correct: boolean | null; questions: { syllabus_node_id: string | null } | null }>(() =>
      supabase()
        .from("attempt_answers")
        .select("is_correct, questions!inner(syllabus_node_id)")
        .not("is_correct", "is", null),
    ),
    // Deliberately UNSCOPED. `loadNodeWeightage(exam)` filters on
    // `mv_node_weightage.exam_code`, which is PROVENANCE ("which exam asked
    // this question"), not the node's own exam — so scoping it to 'uppsc' would
    // DROP the up_ro_aro / upsssc_pet rows that legitimately belong to UPPSC's
    // bank and silently change UPPSC's hotness, hence its weak-topic ordering.
    // The map is keyed by node id and syllabus nodes are exam-exclusive
    // (verified live: 0 of 1829 weightage rows sit on a node from a different
    // exam), so an unscoped load already yields exactly this exam's rows for
    // every node we look up.
    loadNodeWeightage(),
    examSyllabusNodeIds(examCode),
  ]);
  const year = currentExamYear();
  const byNode = new Map<string, { correct: number; total: number }>();
  for (const row of rows) {
    const nodeId = row.questions?.syllabus_node_id;
    if (!nodeId) continue;
    // Scope to THIS exam's syllabus. Without it the normalisation below is
    // computed over every exam's weak topics at once, so `hot / maxHot` for a
    // small/new exam is flattened by a larger exam's absolute question counts
    // and the ranking degrades to weakness-only. (No-op for UPPSC today —
    // measured: zero graded answers sit on a UPSC paper, so the ranked list is
    // byte-identical either way.)
    if (!examNodeIds.has(nodeId)) continue;
    const b = byNode.get(nodeId) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (row.is_correct) b.correct += 1;
    byNode.set(nodeId, b);
  }
  const entries = [...byNode.entries()]
    .filter(([, b]) => b.total > 0 && b.correct / b.total < threshold)
    .map(([id, b]) => ({
      id,
      weakness: 1 - b.correct / b.total,
      hot: hotnessRaw(weightage.get(id)?.byYear ?? new Map(), year),
    }));
  return rankWeakNodes(entries);
}

/**
 * Order below-threshold weak nodes by a COMBINED weak-AND-heavily-tested score.
 * Pure (no I/O) so the "weak-but-rare vs weak-and-common" prioritization is
 * directly testable. `weakness` and `hot` are both normalized to [0,1] and
 * summed (equal weight); a topic that's weak AND hot outranks one that's equally
 * weak but rarely asked. Not a filter — every input node is returned, reordered.
 */
export function rankWeakNodes(entries: { id: string; weakness: number; hot: number }[]): string[] {
  const maxHot = entries.reduce((m, w) => (w.hot > m ? w.hot : m), 0) || 1;
  return entries
    .map((w) => ({ id: w.id, score: w.weakness + w.hot / maxHot }))
    .sort((a, b) => b.score - a.score)
    .map((w) => w.id);
}

/**
 * Question ids used in THIS PAPER's daily quiz within the last `days` days — the
 * spaced-reuse skip set. Scoped to the variant's own paper (so a GS question
 * shown yesterday never blocks a CSAT slot, and vice versa) and platform-wide
 * (which past daily_quiz test rows of that paper included which questions), not
 * any one user's answer history, since this is what actually determines whether
 * a question would look "repeated" to everyone taking the shared quiz. Legacy
 * pre-split rows (paper_code NULL) are ignored — the paper filter excludes
 * them — so a paper's recency window is clean of the old blended pool.
 *
 * NOT exam-scoped (0106): this filters on paper_code alone, which is correct only
 * while paper codes are globally unique across exams. A second exam building daily
 * quizzes needs an exam_code filter here, or the two exams' recency windows blend.
 */
async function recentlyUsedInDailyQuiz(days: number, examCode: string, paperCode: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: tests, error: tErr } = await supabase()
    .from("tests")
    .select("id")
    // Exam-scoped as well as paper-scoped: without it two exams' recency
    // windows blend, so one exam's quiz suppresses questions the other exam's
    // candidates have never seen — the anti-repetition rule silently thinning
    // the pool for a cohort it was never measuring.
    .eq("exam_code", examCode)
    .eq("paper_code", paperCode)
    .gte("scheduled_date", cutoff);
  if (tErr) throw new Error(`recent daily quizzes lookup failed: ${tErr.message}`);
  const testIds = (tests ?? []).map((r) => r.id as string);
  if (testIds.length === 0) return new Set();
  const { data, error } = await supabase().from("test_questions").select("question_id").in("test_id", testIds);
  if (error) throw new Error(`recent daily quiz questions lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.question_id as string));
}

/**
 * Generated MCQs on weak topics first, then any generated MCQ. Published +
 * approved only, and — like `pyqPool` — excluding any generated MCQ used in a
 * recent daily quiz (`seen`), so the same generated questions don't recur every
 * few days. Exclusion is applied before the weak/rest split, so a short weak
 * pool degrades into "rest" generated (and ultimately the backfill reservoir)
 * rather than re-serving a recently-seen weak question.
 */
async function generatedPool(
  paperCode: string,
  weakNodes: string[],
  seen: Set<string>,
  topByNode: Map<string, string>,
): Promise<PoolItem[]> {
  // Paginate (selectAll + stable order), same as pyqPool: generated MCQs now
  // exceed 1000, and a single select silently truncates to the first 1000
  // (PostgREST cap) — so the last ~255 generated questions were never eligible
  // for this slice and the quiz skewed to early ids. That truncation is a second
  // cause of the same felt repetition this recency fix targets.
  // Scoped to this quiz's paper (PRE_GS1 / PRE_CSAT) so the two quizzes never
  // draw from each other's pool.
  const data = await selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() =>
    supabase()
      .from("questions")
      .select("id, marks, syllabus_node_id")
      .eq("type", "mcq")
      .eq("source", "generated")
      .eq("paper_code", paperCode)
      .or(assemblyVisibilityOrFilter())
      .order("id", { ascending: true }),
  );
  const rows = data.filter((r) => !seen.has(r.id));
  // `weakNodes` is already priority-ordered (weak AND heavily-tested first —
  // see globalWeakNodeIds). Serve weak-topic questions in THAT node order, so a
  // weak-and-common topic's questions come before a weak-but-rare one's, then
  // the rest as depth. Questions within the same node are shuffled for variety.
  const rank = new Map(weakNodes.map((id, i) => [id, i]));
  const onWeak = rows.filter((r) => r.syllabus_node_id && rank.has(r.syllabus_node_id));
  const rest = rows.filter((r) => !(r.syllabus_node_id && rank.has(r.syllabus_node_id)));
  const byNode = new Map<string, typeof onWeak>();
  for (const r of shuffle(onWeak)) (byNode.get(r.syllabus_node_id!) ?? byNode.set(r.syllabus_node_id!, []).get(r.syllabus_node_id!)!).push(r);
  const orderedWeak = weakNodes.flatMap((id) => byNode.get(id) ?? []);
  return [...orderedWeak, ...shuffle(rest)].map((r) => ({
    id: r.id,
    marks: r.marks ?? DEFAULT_MCQ_MARKS,
    top: sectionOf(r.syllabus_node_id, topByNode),
  }));
}

/**
 * Order a pool so questions NOT used in a recent daily quiz come first, keeping
 * the recently-seen ones as a tail rather than dropping them.
 *
 * Used by the two pools that previously had NO recency handling at all — the
 * current-affairs slice and the `random` slice, which is also the backfill
 * reservoir — so a repeat now happens only when the pool genuinely has nothing
 * fresher, instead of at random. Deliberately PREFER rather than EXCLUDE here:
 * `random` is what guarantees the quiz reaches full length, and hard-excluding a
 * fortnight of it could ship a short quiz. The `pyq` and `generated` slices keep
 * their existing hard exclusion — their pools are large (1,022 approved MCQs on
 * PRE_GS1 alone) and that behaviour is working.
 */
function unseenFirst(rows: PoolItem[], seen: ReadonlySet<string>): PoolItem[] {
  if (seen.size === 0) return rows;
  return [...rows.filter((r) => !seen.has(r.id)), ...rows.filter((r) => seen.has(r.id))];
}

async function pyqPool(paperCode: string, seen: Set<string>, topByNode: Map<string, string>): Promise<PoolItem[]> {
  // Paginate: published pyq MCQs exceed 1000, so a single select truncated the
  // pool to the first 1000 (biasing every daily quiz toward earlier questions).
  // Scoped to this quiz's paper (PRE_GS1 / PRE_CSAT).
  const data = await selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() =>
    supabase()
      .from("questions")
      .select(MCQ_COLUMNS)
      .eq("type", "mcq")
      .eq("source", "pyq")
      .eq("paper_code", paperCode)
      .or(assemblyVisibilityOrFilter())
      .order("id", { ascending: true }),
  );
  const rows = data.filter((r) => !seen.has(r.id));
  return shuffle(rows).map((r) => ({
    id: r.id,
    marks: r.marks ?? DEFAULT_MCQ_MARKS,
    top: sectionOf(r.syllabus_node_id, topByNode),
  }));
}

async function currentAffairsPool(
  days: number,
  examCode: string,
  seen: ReadonlySet<string>,
  topByNode: Map<string, string>,
): Promise<PoolItem[]> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: items, error: itemsErr } = await supabase()
    .from("current_affairs_items")
    .select("mcq_question_ids")
    // The other three slices are exam-scoped through `paper_code`, but CA MCQs
    // all sit under the synthetic CURRENT_AFFAIRS paper, so this slice has no
    // paper to scope by — without the exam filter a second exam's quiz would
    // pull the UPPSC pipeline's current affairs. `overlaps`, not equality: one
    // national story is deliberately relevant to several exams (0106 §11).
    .overlaps("exam_codes", [examCode])
    .eq("is_published", true)
    .gte("date", cutoff);
  if (itemsErr) throw new Error(`current affairs lookup failed: ${itemsErr.message}`);
  const ids = [...new Set((items ?? []).flatMap((i) => (i.mcq_question_ids ?? []) as string[]))];
  if (ids.length === 0) return [];
  // Chunk the id list: `.in("id", ids)` becomes a URL query param, and a large
  // list (the CA bank now has ~400 linked MCQs) makes the URL exceed the HTTP
  // client's limit → an opaque "TypeError: fetch failed". Batch in groups of 100.
  const rows: { id: string; marks: number | null; syllabus_node_id: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase()
      .from("questions")
      .select(MCQ_COLUMNS)
      .in("id", ids.slice(i, i + 100))
      // ⚑ WAS `questionVisibilityOrFilter("test")`, and that was a live defect.
      // The "test" scope admits ANY question on the CURRENT_AFFAIRS paper code
      // regardless of publish/review state — an exception written when a CA MCQ
      // could never be approved at all. It can now, and 1,451 uppsc CA MCQs are;
      // what the exception uniquely admitted had become the 331 a human REJECTED.
      // Measured before this change: 30 unapproved questions (mostly rejected)
      // were sitting in 21 live daily quizzes — the shared paper that feeds the
      // competitive daily board. This is an ASSEMBLY path, so it takes the
      // assembly filter, which has no scope argument to get wrong.
      .or(assemblyVisibilityOrFilter());
    if (error) throw new Error(`current affairs question lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
  }
  return unseenFirst(
    shuffle(rows).map((r) => ({
      id: r.id,
      marks: r.marks ?? DEFAULT_MCQ_MARKS,
      top: sectionOf(r.syllabus_node_id, topByNode),
    })),
    seen,
  );
}

/**
 * Every catalog-visible MCQ IN THIS PAPER — the random-coverage slice AND the
 * per-paper backfill reservoir. Scoped to the variant's paper so a short GS
 * slice never backfills with a CSAT question (and vice versa).
 */
async function randomPool(
  paperCode: string,
  seen: ReadonlySet<string>,
  topByNode: Map<string, string>,
): Promise<PoolItem[]> {
  // Paginate: the full catalog MCQ set (2000+) exceeds the 1000-row cap, and this
  // pool is BOTH the random slice and the backfill reservoir — so a single select
  // silently shrank both to the first 1000 ids. Stable order for complete
  // pagination; shuffled below.
  const data = await selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() =>
    supabase()
      .from("questions")
      .select(MCQ_COLUMNS)
      .eq("type", "mcq")
      .eq("paper_code", paperCode)
      .or(assemblyVisibilityOrFilter())
      .order("id", { ascending: true }),
  );
  return unseenFirst(
    shuffle(data).map((r) => ({
      id: r.id,
      marks: r.marks ?? DEFAULT_MCQ_MARKS,
      top: sectionOf(r.syllabus_node_id, topByNode),
    })),
    seen,
  );
}

async function upsertDailyQuizTest(input: {
  slug: string;
  date: string;
  examCode: string;
  paperCode: string;
  title: { hi: string; en: string };
  durationMinutes: number;
  totalMarks: number;
  meta: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug: input.slug,
        title_i18n: input.title,
        kind: "daily_quiz",
        // Stamped explicitly. Relying on the column default would silently tag
        // every second exam's quiz `uppsc` — and because the default is a
        // perfectly valid exam code, nothing would ever error.
        exam_code: input.examCode,
        paper_code: input.paperCode,
        scheduled_date: input.date,
        duration_minutes: input.durationMinutes,
        total_marks: input.totalMarks,
        is_published: true,
        meta: input.meta,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`daily quiz upsert failed: ${error.message}`);
  return data.id as string;
}

/**
 * `upsertDailyQuizTest`'s slug upsert makes the `tests` row itself race-safe,
 * but this delete-then-insert pair is NOT atomic against another concurrent
 * build for the SAME date (two self-heal callers — e.g. two dashboard loads
 * or a double-click on "Generate today's quiz" firing before the button
 * disables — both finding no existing row and racing `buildDailyQuiz`).
 * Postgres surfaces that race as either a `test_questions (test_id,
 * question_id)` unique-violation (23505 — the other caller's insert landed
 * between our delete and our insert) or occasionally a detected deadlock
 * (40P01) from the two delete+insert pairs taking row locks in different
 * orders. Either way, the other caller's build has either just finished or is
 * about to, leaving a perfectly good, self-consistent membership set for the
 * same testId — so adopt whatever is now actually persisted instead of
 * surfacing a 500 to whichever request lost the race (same "loser's result
 * is simply discarded, not an error" convention as the evaluation-translation
 * cache's `ignoreDuplicates` upsert).
 */
async function setMembership(testId: string, items: PoolItem[]): Promise<PoolItem[]> {
  const del = await supabase().from("test_questions").delete().eq("test_id", testId);
  if (del.error) throw new Error(`clear members failed: ${del.error.message}`);
  if (items.length === 0) return [];
  const rows = items.map((it, i) => ({ test_id: testId, question_id: it.id, order_index: i, marks: it.marks }));
  const ins = await supabase().from("test_questions").insert(rows);
  if (ins.error) {
    if (ins.error.code === "23505" || ins.error.code === "40P01") {
      const { data: existing, error: reErr } = await supabase()
        .from("test_questions")
        .select("question_id, marks")
        .eq("test_id", testId);
      if (!reErr && existing && existing.length > 0) {
        // `top` is only used to CHOOSE questions; by here the choosing is over
        // and this is the other caller's already-persisted set, read back purely
        // so size/total_marks are reported truthfully. UNMAPPED_SECTION rather
        // than a second round trip to re-derive sections we will never use.
        return existing.map((r) => ({
          id: r.question_id as string,
          marks: (r.marks as number | null) ?? 0,
          top: UNMAPPED_SECTION,
        }));
      }
    }
    throw new Error(`insert members failed: ${ins.error.message}`);
  }
  return items;
}

/** Options for building ONE variant, whose exam is a property of the variant. */
export interface BuildDailyQuizVariantOptions {
  date: string;
  size?: number;
  log?: Log;
}

export interface BuildDailyQuizOptions extends BuildDailyQuizVariantOptions {
  /**
   * Which exams to build for. REQUIRED — no default. A defaulted exam set is
   * exactly how a scheduled job silently keeps building for one exam while
   * looking parameterised (this repo's M24 lesson), and here the opposite
   * mistake is worse still: defaulting to "every configured variant" would
   * enrol a not-yet-live exam in the nightly cron and write real `tests` rows
   * for it. The policy decision lives at the two call sites that own it —
   * `daily/run.ts` (CLI + `--exam` override) and `daily/scheduler.ts`.
   */
  examCodes: string[];
}

/** One variant's build outcome, tagged with the exam it belongs to. */
export interface DailyQuizBuildOutcome {
  examCode: string;
  variant: DailyQuizPaper;
  /** null when that variant had genuinely no questions to build from. */
  result: DailyQuizBuildResult | null;
}

/** What `selectDailyQuizItems` decided, before anything is persisted. */
export interface DailyQuizSelection {
  items: PoolItem[];
  /** The clamped target size the selection aimed at (may exceed `items.length`). */
  size: number;
  breakdown: Record<QuizSlice, number>;
  shortfalls: DailyQuizBuildResult["shortfalls"];
  backfilled: number;
  /** How many candidates each pool offered — diagnostics for a replay. */
  poolSizes: Record<QuizSlice, number>;
  /** Largest per-section gap between the assembled quiz and its weightage target, in pp. */
  deviation: number;
  /** How many chosen questions were used in a daily quiz of this paper recently. */
  repeatsRecent: number;
}

/**
 * Build the daily quizzes for every requested exam, each variant from its own
 * paper's pool. Returns one entry per (exam, variant), with a null `result` for
 * a variant that had genuinely no questions to build from. Variants are built
 * sequentially — they are independent, but their per-paper pool queries are
 * heavy (full paginated MCQ scans), so running them back-to-back keeps the DB
 * load flat rather than multiplying concurrent scans.
 */
export async function buildDailyQuizzes(opts: BuildDailyQuizOptions): Promise<DailyQuizBuildOutcome[]> {
  const out: DailyQuizBuildOutcome[] = [];
  for (const examCode of opts.examCodes) {
    // An exam with no configured variants contributes nothing — the honest
    // answer, and the same one `variantsForExam` gives every other caller.
    for (const variant of variantsForExam(examCode)) {
      // `size` (a manual override) only applies to the GS quiz — CSAT keeps its
      // own configured, smaller default. A blanket override would blow CSAT past
      // its narrow pool.
      const result = await buildDailyQuizVariant(variant, {
        ...opts,
        size: variant.key === "gs" ? opts.size : undefined,
      });
      out.push({ examCode, variant: variant.key, result });
    }
  }
  return out;
}

/**
 * Choose one variant's question set. PURE READ — no insert, no update, no
 * upsert; every query below is a select. Split out of `buildDailyQuizVariant`
 * (which persists what this returns) so the selection policy can be replayed
 * and diffed against a live database without writing a single row, which is
 * the only safe way to verify a change to it: this database is the same
 * Supabase project for dev and production.
 *
 * Returns null when no pool yielded anything at all.
 */
export async function selectDailyQuizItems(
  variant: DailyQuizVariant,
  opts: { size?: number; log?: Log },
): Promise<DailyQuizSelection | null> {
  const cfg = variant.config;
  const log = opts.log ?? (() => {});
  const size = clampSize(opts.size ?? cfg.defaultSize, cfg);
  const { paperCode, examCode } = variant;

  const weak = await globalWeakNodeIds(cfg.weakAccuracyThreshold, examCode);
  // `recentlyUsedInDailyQuiz` returns every question (any slice) used in recent
  // daily quizzes OF THIS PAPER; the pyq and generated slices each skip that set
  // over their own window. Reuse the one query when the windows match (the
  // default) rather than hitting the DB twice for the same result.
  const seen = await recentlyUsedInDailyQuiz(cfg.pyqRecencyDays, examCode, paperCode);
  const genSeen =
    cfg.generatedRecencyDays === cfg.pyqRecencyDays
      ? seen
      : await recentlyUsedInDailyQuiz(cfg.generatedRecencyDays, examCode, paperCode);
  // The paper's node->section map and its per-section weightage, so every slice's
  // items carry a section and the whole quiz can be balanced against how often
  // the commission actually asks each one.
  const [topByNode, weightage] = await Promise.all([topLevelByNode(paperCode), loadNodeWeightage()]);
  const hot = await sectionHotness(paperCode, weightage, currentExamYear());
  const weightOf = (top: string) => hot.get(top) ?? 0;
  const [gen, pyq, ca, rand] = await Promise.all([
    generatedPool(paperCode, weak, genSeen, topByNode),
    pyqPool(paperCode, seen, topByNode),
    // Current affairs is GS content only — the CSAT variant never includes it
    // (its ratio is 0 too, so this is belt-and-suspenders).
    variant.includeCurrentAffairs
      ? currentAffairsPool(cfg.currentAffairsDays, examCode, seen, topByNode)
      : Promise.resolve([]),
    randomPool(paperCode, seen, topByNode),
  ]);
  const pools: Record<QuizSlice, PoolItem[]> = { generated: gen, pyq, current_affairs: ca, random: rand };
  const poolSizes: Record<QuizSlice, number> = {
    generated: gen.length,
    pyq: pyq.length,
    current_affairs: ca.length,
    random: rand.length,
  };
  log(
    `pools: generated=${gen.length} pyq=${pyq.length} current_affairs=${ca.length} random=${rand.length} ` +
      `(weak topics=${weak.length}, recently-seen pyq=${seen.size} generated=${genSeen.size})`,
  );

  const targets = sliceTargets(size, cfg.ratios);
  const chosen = new Map<string, PoolItem>();
  const breakdown: Record<QuizSlice, number> = { generated: 0, pyq: 0, current_affairs: 0, random: 0 };
  const shortfalls: DailyQuizBuildResult["shortfalls"] = [];

  // ⚑ ONE running per-section tally SHARED across all four slices, which is the
  // whole point. Each slice still has its own size (a content-type quota, a
  // separate product decision), but each one picks the section the QUIZ SO FAR is
  // furthest below target on — so the four slices compose into one paper whose
  // topic mix tracks real weightage. Balancing each slice independently would
  // not achieve this: they draw from differently shaped pools, and four
  // separately-balanced draws still add up to a skewed paper.
  //
  // Before this, the daily quiz had no balancing at all and it showed: measured
  // on the last three GS quizzes, max section deviation was 13.1 / 14.9 / 21.4pp.
  // 2026-07-31 gave Economic & Social Development ZERO questions against a 15%
  // target; 2026-08-05 gave Environmental Ecology 8/25 (32%) on an 11% target
  // while Polity took 1/25 (4%) on 16%.
  const running = new Map<string, number>();

  for (const slice of SLICE_FILL_ORDER) {
    const target = targets[slice];
    // `balancedPick` preserves each pool's own within-section order, so the
    // generated slice's weak-topic priority and the unseen-first ordering of the
    // CA/random pools both survive — balancing is a cross-section concern only.
    const picked = balancedPick({
      pool: pools[slice],
      count: target,
      weightOf,
      running,
      placedTotal: chosen.size,
      exclude: new Set(chosen.keys()),
    });
    for (const item of picked) chosen.set(item.id, item);
    breakdown[slice] = picked.length;
    if (picked.length < target) {
      shortfalls.push({ slice, target, filled: picked.length });
      log(`slice "${slice}" short: filled ${picked.length}/${target} — will backfill from other pools`);
    }
  }

  // Backfill to `size` from the leftover reservoir (random first — the general
  // coverage pool — then the remaining slice pools), so a thin slice never ships
  // a thin quiz. Balanced too, and against the SAME running tally: the backfill
  // is where a short slice's slots actually land, so filling it in pool order
  // would undo the balancing the slices just did.
  const reservoir = [...pools.random, ...pools.pyq, ...pools.generated, ...pools.current_affairs];
  const backfill = balancedPick({
    pool: reservoir,
    count: size - chosen.size,
    weightOf,
    running,
    placedTotal: chosen.size,
    exclude: new Set(chosen.keys()),
  });
  for (const item of backfill) chosen.set(item.id, item);
  const backfilled = backfill.length;
  if (backfilled > 0) log(`backfilled ${backfilled} question(s) to reach ${chosen.size}/${size}`);

  if (chosen.size === 0) {
    log("no questions available in any pool — skipping daily quiz for this date");
    return null;
  }
  if (chosen.size < cfg.minSize) {
    log(`only ${chosen.size} questions available (min ${cfg.minSize}) — shipping a smaller quiz than intended`);
  }

  const items = [...chosen.values()];
  const deviation = maxSectionDeviationPct(items, weightOf, hot.keys());
  const repeatsRecent = items.filter((it) => seen.has(it.id)).length;
  log(
    `topic mix: max section deviation ${deviation.toFixed(1)}pp; ` +
      `${repeatsRecent}/${items.length} question(s) seen in the last ${cfg.pyqRecencyDays} days`,
  );

  return { items: shuffle(items), size, breakdown, shortfalls, backfilled, poolSizes, deviation, repeatsRecent };
}

export async function buildDailyQuizVariant(
  variant: DailyQuizVariant,
  opts: BuildDailyQuizVariantOptions,
): Promise<DailyQuizBuildResult | null> {
  const cfg = variant.config;
  const log = opts.log ?? (() => {});
  const { date } = opts;
  const { paperCode, examCode } = variant;

  const selection = await selectDailyQuizItems(variant, { size: opts.size, log });
  if (!selection) return null;
  const { items: finalItems, breakdown, shortfalls, backfilled } = selection;

  const totalMarks = roundMarks(finalItems.reduce((s, it) => s + (it.marks ?? 0), 0));
  const d = formatDateBilingual(date);
  // `tests.slug` is globally unique and is this build's idempotency key, so it
  // must carry the exam for anything but the default: two exams both building a
  // "gs" quiz on the same date would otherwise upsert onto the SAME row, each
  // overwriting the other's title, paper and membership. The default exam keeps
  // its historical bare slug so no existing daily-quiz row is orphaned.
  const slug =
    examCode === DEFAULT_EXAM_CODE ? `daily:${date}:${variant.key}` : `daily:${date}:${examCode}:${variant.key}`;

  const testId = await upsertDailyQuizTest({
    slug,
    date,
    examCode,
    paperCode,
    title: {
      en: `Daily Quiz (${variant.labelI18n.en}) — ${d.en}`,
      hi: `डेली क्विज़ (${variant.labelI18n.hi}) — ${d.hi}`,
    },
    durationMinutes: finalItems.length, // ~1 min/question — a gentle exam-like pace, auto-submits on expiry.
    totalMarks,
    meta: {
      source: "daily_quiz",
      date,
      paper: variant.key,
      marking_scheme: cfg.markingScheme,
      slice_breakdown: breakdown,
      shortfalls,
      backfilled,
    },
  });
  // `persisted` is normally just `finalItems` echoed back — it only differs
  // from our own selection when a concurrent build for the same date won the
  // race in setMembership, in which case it's the OTHER caller's actually-
  // persisted set. Reporting size/total_marks from `persisted` (not
  // `finalItems`) keeps this call's return value truthful to what's really
  // in the DB either way; slice_breakdown/shortfalls/backfilled stay this
  // attempt's own diagnostics (informational only — a losing racer's numbers
  // describing its own discarded selection is a minor, accepted inaccuracy).
  const persisted = await setMembership(testId, finalItems);
  const persistedMarks = roundMarks(persisted.reduce((s, it) => s + (it.marks ?? 0), 0));

  // upsertDailyQuizTest already wrote this build's OWN totalMarks/duration
  // onto the tests row above — fine when this call won the setMembership
  // race (persisted === finalItems), but stale if a concurrent build won
  // instead (persisted is the other caller's set, of a possibly different
  // size). Reconcile so the row's own total_marks/duration_minutes always
  // match what's actually in test_questions, regardless of which caller's
  // upsert happened to run last. Cheap and convergent either way: a losing
  // caller writes the same true numbers a winning caller would already have
  // written, so two racing corrections agree rather than fight.
  if (persistedMarks !== totalMarks || persisted.length !== finalItems.length) {
    const { error: reconcileErr } = await supabase()
      .from("tests")
      .update({ total_marks: persistedMarks, duration_minutes: persisted.length })
      .eq("id", testId);
    if (reconcileErr) log(`warning: failed to reconcile total_marks/duration after a build race: ${reconcileErr.message}`);
  }

  log(
    `built ${slug}: ${persisted.length} questions (` +
      SLICE_FILL_ORDER.map((s) => `${s}=${breakdown[s]}`).join(" ") +
      `${backfilled ? ` backfill=${backfilled}` : ""}) total_marks=${persistedMarks}`,
  );

  return {
    test_id: testId,
    date,
    paper: variant.key,
    size: persisted.length,
    total_marks: persistedMarks,
    slice_breakdown: breakdown,
    shortfalls,
    backfilled,
  };
}
