/**
 * Daily-quiz assembler. `buildDailyQuiz` composes ONE daily_quiz test for a
 * given IST date + user, mixing four slices (generated-on-weak-topics, spaced
 * PYQs, this week's current-affairs MCQs, random coverage) per DAILY_QUIZ_CONFIG.
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
import { formatDateBilingual } from "../lib/ist.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { CURRENT_AFFAIRS_PAPER_CODE, questionVisibilityOrFilter } from "../lib/question-visibility.js";
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

/** Leaf topics the user answers below `threshold` accuracy on, weakest first. */
async function weakNodeIds(userId: string, threshold: number): Promise<string[]> {
  const graded = await getGradedAnswers(userId);
  const byNode = new Map<string, { correct: number; total: number }>();
  for (const row of graded) {
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

/** Question ids the user has answered within `days` — the spaced-reuse skip set. */
async function recentlySeenQuestionIds(userId: string, days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data: attempts, error: aErr } = await supabase()
    .from("attempts")
    .select("id")
    .eq("user_id", userId)
    .gte("started_at", cutoff);
  if (aErr) throw new Error(`recent attempts lookup failed: ${aErr.message}`);
  const attemptIds = (attempts ?? []).map((r) => r.id as string);
  if (attemptIds.length === 0) return new Set();
  const { data, error } = await supabase()
    .from("attempt_answers")
    .select("question_id")
    .in("attempt_id", attemptIds);
  if (error) throw new Error(`recent answers lookup failed: ${error.message}`);
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
  const { data, error } = await supabase()
    .from("questions")
    .select(MCQ_COLUMNS)
    .eq("type", "mcq")
    .eq("source", "pyq")
    .or(questionVisibilityOrFilter("catalog"));
  if (error) throw new Error(`pyq pool lookup failed: ${error.message}`);
  const rows = ((data ?? []) as { id: string; marks: number | null }[]).filter((r) => !seen.has(r.id));
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
  const { data, error } = await supabase()
    .from("questions")
    .select(MCQ_COLUMNS)
    .in("id", ids)
    .or(questionVisibilityOrFilter("test"));
  if (error) throw new Error(`current affairs question lookup failed: ${error.message}`);
  return shuffle((data ?? []) as { id: string; marks: number | null }[]).map((r) => ({ id: r.id, marks: r.marks ?? 0 }));
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

async function setMembership(testId: string, items: PoolItem[]): Promise<void> {
  const del = await supabase().from("test_questions").delete().eq("test_id", testId);
  if (del.error) throw new Error(`clear members failed: ${del.error.message}`);
  if (items.length === 0) return;
  const rows = items.map((it, i) => ({ test_id: testId, question_id: it.id, order_index: i, marks: it.marks }));
  const ins = await supabase().from("test_questions").insert(rows);
  if (ins.error) throw new Error(`insert members failed: ${ins.error.message}`);
}

export interface BuildDailyQuizOptions {
  userId: string;
  date: string;
  size?: number;
  config?: DailyQuizConfig;
  log?: Log;
}

export async function buildDailyQuiz(opts: BuildDailyQuizOptions): Promise<DailyQuizBuildResult | null> {
  const cfg = opts.config ?? DAILY_QUIZ_CONFIG;
  const log = opts.log ?? (() => {});
  const size = clampSize(opts.size ?? cfg.defaultSize, cfg);
  const { userId, date } = opts;

  const weak = await weakNodeIds(userId, cfg.weakAccuracyThreshold);
  const seen = await recentlySeenQuestionIds(userId, cfg.pyqRecencyDays);
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
      user_id: userId,
      marking_scheme: cfg.markingScheme,
      slice_breakdown: breakdown,
      shortfalls,
      backfilled,
    },
  });
  await setMembership(testId, finalItems);

  log(
    `built ${slug}: ${finalItems.length} questions (` +
      SLICE_FILL_ORDER.map((s) => `${s}=${breakdown[s]}`).join(" ") +
      `${backfilled ? ` backfill=${backfilled}` : ""}) total_marks=${totalMarks}`,
  );

  return { test_id: testId, date, size: finalItems.length, total_marks: totalMarks, slice_breakdown: breakdown, shortfalls, backfilled };
}
