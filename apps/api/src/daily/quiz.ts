/**
 * Daily-quiz assembler. `buildDailyQuiz` composes ONE daily_quiz test for a
 * given IST date, mixing four slices (generated-on-weak-topics, spaced PYQs,
 * this week's current-affairs MCQs, random coverage) per DAILY_QUIZ_CONFIG.
 *
 * This is a single SHARED test, not a per-user one — `services/scoreboard.ts`
 * ranks every user's attempt on it against each other via
 * `daily_quiz_board_entries`, which only makes sense if everyone took the
 * same set of questions. So "weak topics"/"recently seen" below are
 * platform-wide signals (aggregated across all graded attempts / all past
 * daily quizzes), never any one individual's — there is no single "the user"
 * for a quiz everyone takes. (This function previously took a `userId` and
 * personalized to it; `daily/run.ts`'s nightly job called it once per
 * onboarded user, so each night's build silently overwrote the previous
 * user's build for the very same `tests` row until only the last-processed
 * user's personalization survived — wasteful and, since the "generated"
 * slice draws from a small pool filtered to one user's own weak nodes, a real
 * cause of the same handful of questions recurring night after night for
 * everyone. See docs/OUTSTANDING.md.)
 *
 * Every pool query goes through the centralized question-visibility helper
 * (never an inline is_published filter): the generated/pyq/random slices use
 * "catalog" scope (published + review-approved only), the current-affairs slice
 * uses "test" scope (which additionally admits the review-gated CA pool that is
 * only ever served inside a test). Because a daily_quiz test can therefore carry
 * CA questions, the attempt player/grader — which also runs "test" scope — serves
 * and scores every slice correctly.
 *
 * Idempotent per date: keyed on slug `daily:YYYY-MM-DD`; a re-run rebuilds
 * membership. Yesterday's quiz simply remains a published test (makeup), and the
 * archive lists every past daily_quiz by scheduled_date.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { formatDateBilingual } from "../lib/ist.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import {
  DAILY_QUIZ_CONFIG,
  SLICE_FILL_ORDER,
  clampSize,
  sliceTargets,
  type DailyQuizConfig,
  type QuizSlice,
} from "./config.js";

type Log = (msg: string) => void;

interface PoolItem {
  id: string;
  marks: number;
}

export interface DailyQuizBuildResult {
  test_id: string;
  date: string;
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

const MCQ_COLUMNS = "id, marks";

/**
 * Leaf topics the platform as a whole answers below `threshold` accuracy on,
 * weakest first — aggregated across every user's graded attempts, not any
 * one individual's (see the module doc comment: this is a shared quiz).
 * Paginated (selectAll) since attempt_answers is unbounded and PostgREST caps
 * a single select at 1000 rows.
 */
async function globalWeakNodeIds(threshold: number): Promise<string[]> {
  const rows = await selectAll<{ is_correct: boolean | null; questions: { syllabus_node_id: string | null } | null }>(
    () =>
      supabase()
        .from("attempt_answers")
        .select("is_correct, questions!inner(syllabus_node_id)")
        .not("is_correct", "is", null),
  );
  const byNode = new Map<string, { correct: number; total: number }>();
  for (const row of rows) {
    const nodeId = row.questions?.syllabus_node_id;
    if (!nodeId) continue;
    const b = byNode.get(nodeId) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (row.is_correct) b.correct += 1;
    byNode.set(nodeId, b);
  }
  return [...byNode.entries()]
    .filter(([, b]) => b.total > 0 && b.correct / b.total < threshold)
    .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)
    .map(([id]) => id);
}

/**
 * Question ids used in a daily quiz within the last `days` days — the
 * spaced-reuse skip set. Platform-wide (which past daily_quiz test rows
 * included which questions), not any one user's answer history, since this
 * is what actually determines whether a question would look "repeated" to
 * everyone taking the shared quiz.
 */
async function recentlyUsedInDailyQuiz(days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: tests, error: tErr } = await supabase()
    .from("tests")
    .select("id")
    .eq("kind", "daily_quiz")
    .gte("scheduled_date", cutoff);
  if (tErr) throw new Error(`recent daily quizzes lookup failed: ${tErr.message}`);
  const testIds = (tests ?? []).map((r) => r.id as string);
  if (testIds.length === 0) return new Set();
  const { data, error } = await supabase().from("test_questions").select("question_id").in("test_id", testIds);
  if (error) throw new Error(`recent daily quiz questions lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.question_id as string));
}

/** Generated MCQs on the user's weak topics first, then any generated MCQ. Published + approved only. */
async function generatedPool(weakNodes: string[]): Promise<PoolItem[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, marks, syllabus_node_id")
    .eq("type", "mcq")
    .eq("source", "generated")
    .or(questionVisibilityOrFilter("catalog"));
  if (error) throw new Error(`generated pool lookup failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; marks: number | null; syllabus_node_id: string | null }[];
  const weak = new Set(weakNodes);
  const onWeak = rows.filter((r) => r.syllabus_node_id && weak.has(r.syllabus_node_id));
  const rest = rows.filter((r) => !(r.syllabus_node_id && weak.has(r.syllabus_node_id)));
  // Weak-topic questions first (the point of this slice), then the rest as depth.
  return [...shuffle(onWeak), ...shuffle(rest)].map((r) => ({ id: r.id, marks: r.marks ?? 0 }));
}

async function pyqPool(seen: Set<string>): Promise<PoolItem[]> {
  // Paginate: published pyq MCQs exceed 1000, so a single select truncated the
  // pool to the first 1000 (biasing every daily quiz toward earlier questions).
  const data = await selectAll<{ id: string; marks: number | null }>(() =>
    supabase()
      .from("questions")
      .select(MCQ_COLUMNS)
      .eq("type", "mcq")
      .eq("source", "pyq")
      .or(questionVisibilityOrFilter("catalog"))
      .order("id", { ascending: true }),
  );
  const rows = data.filter((r) => !seen.has(r.id));
  return shuffle(rows).map((r) => ({ id: r.id, marks: r.marks ?? 0 }));
}

async function currentAffairsPool(days: number): Promise<PoolItem[]> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: items, error: itemsErr } = await supabase()
    .from("current_affairs_items")
    .select("mcq_question_ids")
    .eq("is_published", true)
    .gte("date", cutoff);
  if (itemsErr) throw new Error(`current affairs lookup failed: ${itemsErr.message}`);
  const ids = [...new Set((items ?? []).flatMap((i) => (i.mcq_question_ids ?? []) as string[]))];
  if (ids.length === 0) return [];
  // Chunk the id list: `.in("id", ids)` becomes a URL query param, and a large
  // list (the CA bank now has ~400 linked MCQs) makes the URL exceed the HTTP
  // client's limit → an opaque "TypeError: fetch failed". Batch in groups of 100.
  const rows: { id: string; marks: number | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase()
      .from("questions")
      .select(MCQ_COLUMNS)
      .in("id", ids.slice(i, i + 100))
      .or(questionVisibilityOrFilter("test"));
    if (error) throw new Error(`current affairs question lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as { id: string; marks: number | null }[]));
  }
  return shuffle(rows).map((r) => ({ id: r.id, marks: r.marks ?? 0 }));
}

/** Every catalog-visible MCQ — the random-coverage slice AND the backfill reservoir. */
async function randomPool(): Promise<PoolItem[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select(MCQ_COLUMNS)
    .eq("type", "mcq")
    .or(questionVisibilityOrFilter("catalog"));
  if (error) throw new Error(`random pool lookup failed: ${error.message}`);
  return shuffle((data ?? []) as { id: string; marks: number | null }[]).map((r) => ({ id: r.id, marks: r.marks ?? 0 }));
}

async function upsertDailyQuizTest(input: {
  slug: string;
  date: string;
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
        paper_code: null,
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
        return existing.map((r) => ({ id: r.question_id as string, marks: (r.marks as number | null) ?? 0 }));
      }
    }
    throw new Error(`insert members failed: ${ins.error.message}`);
  }
  return items;
}

export interface BuildDailyQuizOptions {
  date: string;
  size?: number;
  config?: DailyQuizConfig;
  log?: Log;
}

export async function buildDailyQuiz(opts: BuildDailyQuizOptions): Promise<DailyQuizBuildResult | null> {
  const cfg = opts.config ?? DAILY_QUIZ_CONFIG;
  const log = opts.log ?? (() => {});
  const size = clampSize(opts.size ?? cfg.defaultSize, cfg);
  const { date } = opts;

  const weak = await globalWeakNodeIds(cfg.weakAccuracyThreshold);
  const seen = await recentlyUsedInDailyQuiz(cfg.pyqRecencyDays);
  const [gen, pyq, ca, rand] = await Promise.all([
    generatedPool(weak),
    pyqPool(seen),
    currentAffairsPool(cfg.currentAffairsDays),
    randomPool(),
  ]);
  const pools: Record<QuizSlice, PoolItem[]> = { generated: gen, pyq, current_affairs: ca, random: rand };
  log(
    `pools: generated=${gen.length} pyq=${pyq.length} current_affairs=${ca.length} random=${rand.length} ` +
      `(weak topics=${weak.length}, recently-seen=${seen.size})`,
  );

  const targets = sliceTargets(size, cfg.ratios);
  const chosen = new Map<string, PoolItem>();
  const breakdown: Record<QuizSlice, number> = { generated: 0, pyq: 0, current_affairs: 0, random: 0 };
  const shortfalls: DailyQuizBuildResult["shortfalls"] = [];

  for (const slice of SLICE_FILL_ORDER) {
    const target = targets[slice];
    let filled = 0;
    for (const item of pools[slice]) {
      if (filled >= target) break;
      if (chosen.has(item.id)) continue;
      chosen.set(item.id, item);
      filled += 1;
    }
    breakdown[slice] = filled;
    if (filled < target) {
      shortfalls.push({ slice, target, filled });
      log(`slice "${slice}" short: filled ${filled}/${target} — will backfill from other pools`);
    }
  }

  // Backfill to `size` from the leftover reservoir (random first — the general
  // coverage pool — then the remaining slice pools), so a thin slice never ships
  // a thin quiz.
  let backfilled = 0;
  const reservoir = [...pools.random, ...pools.pyq, ...pools.generated, ...pools.current_affairs];
  for (const item of reservoir) {
    if (chosen.size >= size) break;
    if (chosen.has(item.id)) continue;
    chosen.set(item.id, item);
    backfilled += 1;
  }
  if (backfilled > 0) log(`backfilled ${backfilled} question(s) to reach ${chosen.size}/${size}`);

  if (chosen.size === 0) {
    log("no questions available in any pool — skipping daily quiz for this date");
    return null;
  }
  if (chosen.size < cfg.minSize) {
    log(`only ${chosen.size} questions available (min ${cfg.minSize}) — shipping a smaller quiz than intended`);
  }

  const finalItems = shuffle([...chosen.values()]);
  const totalMarks = finalItems.reduce((s, it) => s + (it.marks ?? 0), 0);
  const d = formatDateBilingual(date);
  const slug = `daily:${date}`;

  const testId = await upsertDailyQuizTest({
    slug,
    date,
    title: { en: `Daily Quiz — ${d.en}`, hi: `डेली क्विज़ — ${d.hi}` },
    durationMinutes: finalItems.length, // ~1 min/question — a gentle exam-like pace, auto-submits on expiry.
    totalMarks,
    meta: {
      source: "daily_quiz",
      date,
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
  const persistedMarks = persisted.reduce((s, it) => s + (it.marks ?? 0), 0);

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
    size: persisted.length,
    total_marks: persistedMarks,
    slice_breakdown: breakdown,
    shortfalls,
    backfilled,
  };
}
