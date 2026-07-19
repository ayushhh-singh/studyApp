/**
 * Time Attack. A rapid 10-question, 5-minute run over published MCQs from
 * either GS-I or CSAT (whole paper or one topic node), with instant feedback +
 * a combo on the client and a personal best per node. Reuses the attempt
 * engine (kind='time_attack', no negative marking on either paper — this is a
 * speed drill, not a scored exam); the answer key is returned to the client on
 * start because this is a self-practice game.
 *
 * Question selection is NOT uniform-random each run — a small topic (the
 * eligibility floor is only TIME_ATTACK_SIZE questions) would otherwise repeat
 * most of its pool on every replay, which is neither a good drill nor much of
 * a "beat your best" hook. `pickRun` instead prioritizes (1) questions the user
 * has previously gotten wrong in this subtree — reinforcement, capped so a run
 * never becomes a discouraging wall of past mistakes — then (2) never-seen
 * questions, then (3) recently-seen-and-correct as a last resort, so a run is
 * only ever a repeat of yesterday's exact set when the pool is too thin to
 * avoid it.
 */
import type {
  BilingualText,
  PersonalBest,
  TimeAttackPaperCode,
  TimeAttackResult,
  TimeAttackStart,
  TimeAttackTopic,
} from "@neev/shared";
import { TIME_ATTACK_MINUTES, TIME_ATTACK_SIZE, timeAttackPaperCodeSchema } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import { getTestDetail } from "./tests.js";
import { startAttempt } from "./attempts.js";
import { touchFeature } from "../lib/feature-touch.js";

const NO_NEGATIVE = { type: "time_attack", negative_marking: 0, note: "no negative marking" };

/** A previously-wrong question stays eligible for reinforcement, but never more than half of a run. */
const REINFORCEMENT_CAP_RATIO = 0.5;
/** A question answered within this many days is "recently seen" — deprioritized unless it's needed to fill the run. */
const RECENCY_DAYS = 3;

const PAPER_TITLES: Record<TimeAttackPaperCode, BilingualText> = {
  PRE_GS1: { en: "GS-I Time Attack", hi: "जीएस-I टाइम अटैक" },
  PRE_CSAT: { en: "CSAT Time Attack", hi: "सीसैट टाइम अटैक" },
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface PoolQuestion {
  id: string;
  correct_option_key: string | null;
}

async function questionPool(paperCode: TimeAttackPaperCode, nodeIds: string[]): Promise<PoolQuestion[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, correct_option_key")
    .eq("paper_code", paperCode)
    .eq("type", "mcq")
    .eq("is_published", true)
    .in("syllabus_node_id", nodeIds);
  if (error) throw new HttpError(500, `question pool lookup failed: ${error.message}`);
  return (data ?? []) as PoolQuestion[];
}

/**
 * Pick this run's questions from `pool`, favoring reinforcement of past
 * misses and never-seen questions over repeating something recently answered
 * correctly. Always returns exactly `TIME_ATTACK_SIZE` when `pool.length >=
 * TIME_ATTACK_SIZE` (the only case callers reach this from, given the
 * eligibility floor) — never fewer, even for a brand-new user with no history
 * (everything just falls into the "never seen" bucket).
 */
async function pickRun(userId: string, pool: PoolQuestion[]): Promise<PoolQuestion[]> {
  // Filter to this pool in JS (a Set lookup), not in the query — the "All
  // GS-I" pool alone is 500+ questions, and adding `.in("question_id", ...)`
  // with that many UUIDs blows past a practical request-size limit and the
  // fetch itself fails outright (not even a graceful DB error). Matches the
  // shape daily/quiz.ts's pool-membership filters use, for the same reason.
  const poolIdSet = new Set(pool.map((q) => q.id));
  const cutoff = new Date(Date.now() - RECENCY_DAYS * 24 * 3600 * 1000).toISOString();

  const [attemptsRes, recentAttemptsRes] = await Promise.all([
    supabase().from("attempts").select("id").eq("user_id", userId).not("submitted_at", "is", null),
    supabase().from("attempts").select("id").eq("user_id", userId).gte("started_at", cutoff),
  ]);
  if (attemptsRes.error) throw new HttpError(500, `attempt lookup failed: ${attemptsRes.error.message}`);
  if (recentAttemptsRes.error) throw new HttpError(500, `recent attempt lookup failed: ${recentAttemptsRes.error.message}`);
  const allAttemptIds = (attemptsRes.data ?? []).map((r) => r.id as string);
  const recentAttemptIds = new Set((recentAttemptsRes.data ?? []).map((r) => r.id as string));

  // `wrongRecently` and `recentlySeen` must both be evaluated PER ROW, not as
  // two independently-unioned per-question flags — a question wrongly
  // answered weeks ago and separately re-attempted (and gotten right) more
  // recently must NOT count as "recently missed": that was a real bug here,
  // where `wrong.has(q.id) && recentlySeen.has(q.id)` matched any question with
  // a wrong answer EVER and a recent touch EVER, even from two unrelated
  // attempts — on an account with a lot of both, that bucket ballooned to 70+
  // questions and drowned out the ones actually missed moments ago.
  const wrong = new Set<string>();
  const wrongRecently = new Set<string>();
  const recentlySeen = new Set<string>();
  if (allAttemptIds.length > 0) {
    const { data, error } = await supabase()
      .from("attempt_answers")
      .select("attempt_id, question_id, is_correct")
      .in("attempt_id", allAttemptIds);
    if (error) throw new HttpError(500, `answer history lookup failed: ${error.message}`);
    for (const row of (data ?? []) as { attempt_id: string; question_id: string; is_correct: boolean | null }[]) {
      if (!poolIdSet.has(row.question_id)) continue;
      const isRecent = recentAttemptIds.has(row.attempt_id);
      if (row.is_correct === false) {
        wrong.add(row.question_id);
        if (isRecent) wrongRecently.add(row.question_id);
      }
      if (isRecent) recentlySeen.add(row.question_id);
    }
  }

  // Reinforcement priority: missed in a recent attempt first (the "you just
  // got this wrong, drill it again" hook), then anything ever missed, then
  // never-seen content, then anything recently seen and answered correctly
  // (least desirable to repeat).
  const wrongRecent = shuffle(pool.filter((q) => wrongRecently.has(q.id)));
  const wrongOlder = shuffle(pool.filter((q) => wrong.has(q.id) && !wrongRecently.has(q.id)));
  const neverSeen = shuffle(pool.filter((q) => !wrong.has(q.id) && !recentlySeen.has(q.id)));
  const recentOk = shuffle(pool.filter((q) => !wrong.has(q.id) && recentlySeen.has(q.id)));

  const reinforcementCap = Math.ceil(TIME_ATTACK_SIZE * REINFORCEMENT_CAP_RATIO);
  const chosen = new Map<string, PoolQuestion>();
  for (const q of [...wrongRecent, ...wrongOlder]) {
    if (chosen.size >= reinforcementCap) break;
    chosen.set(q.id, q);
  }
  // Fill order after reinforcement: brand-new content first, then anything
  // recently seen (but answered correctly), then — safety net for a pool right
  // at the eligibility floor — whatever's left in the original pool.
  for (const q of [...neverSeen, ...recentOk, ...pool]) {
    if (chosen.size >= TIME_ATTACK_SIZE) break;
    if (!chosen.has(q.id)) chosen.set(q.id, q);
  }
  return shuffle([...chosen.values()]);
}

/** node_id -> subtree path prefixes, for rolling published-count up the CSAT tree. */
function ancestorPaths(path: string): string[] {
  if (!path) return [""];
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(0, i + 1).join("/"));
  out.push("");
  return out;
}

function mapPersonalBest(row: Record<string, unknown> | null | undefined): PersonalBest | null {
  if (!row) return null;
  return {
    syllabus_node_id: row.syllabus_node_id as string,
    best_correct: row.best_correct as number,
    best_total: row.best_total as number,
    best_time_seconds: (row.best_time_seconds as number | null) ?? null,
    best_combo: row.best_combo as number,
    achieved_at: row.achieved_at as string,
  };
}

/** The topics offerable for Time Attack on one paper: the paper root ("All GS-I"/"All CSAT") + any node with >= 10 published MCQs. */
export async function getTimeAttackTopics(userId: string, paperCode: TimeAttackPaperCode): Promise<TimeAttackTopic[]> {
  const [nodesRes, questionsRes, bestsRes] = await Promise.all([
    supabase().from("syllabus_nodes").select("id, depth, path, title_i18n").eq("paper_code", paperCode),
    supabase().from("questions").select("syllabus_node_id").eq("paper_code", paperCode).eq("type", "mcq").eq("is_published", true).not("syllabus_node_id", "is", null),
    supabase().from("personal_bests").select("*").eq("user_id", userId).eq("mode", "time_attack"),
  ]);
  if (nodesRes.error) throw new HttpError(500, `node lookup failed: ${nodesRes.error.message}`);
  if (questionsRes.error) throw new HttpError(500, `question lookup failed: ${questionsRes.error.message}`);
  if (bestsRes.error) throw new HttpError(500, `personal best lookup failed: ${bestsRes.error.message}`);

  const nodes = (nodesRes.data ?? []) as { id: string; depth: number; path: string; title_i18n: BilingualText }[];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const idByPath = new Map(nodes.map((n) => [n.path, n.id]));

  const counts = new Map<string, number>();
  for (const q of (questionsRes.data ?? []) as { syllabus_node_id: string }[]) {
    const leaf = nodeById.get(q.syllabus_node_id);
    if (!leaf) continue;
    for (const ap of ancestorPaths(leaf.path)) {
      const id = idByPath.get(ap);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  // Personal bests are keyed only by node_id (unique across papers), so no
  // paper filter is needed here — a node from another paper simply never
  // matches any id in this paper's `nodes` below.
  const bestByNode = new Map((bestsRes.data ?? []).map((b) => [b.syllabus_node_id as string, b]));

  // Root first (All GS-I / All CSAT), then depth-1 sections with enough supply, biggest first.
  const eligible = nodes
    .filter((n) => (n.depth === 0 || n.depth === 1) && (counts.get(n.id) ?? 0) >= TIME_ATTACK_SIZE)
    .sort((a, b) => a.depth - b.depth || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  return eligible.map((n) => ({
    node_id: n.id,
    paper_code: paperCode,
    title_i18n: n.title_i18n,
    available: counts.get(n.id) ?? 0,
    is_paper_root: n.depth === 0,
    personal_best: mapPersonalBest(bestByNode.get(n.id)),
  }));
}

export async function startTimeAttack(userId: string, nodeId: string): Promise<TimeAttackStart> {
  const { data: node, error: nodeErr } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeErr) throw new HttpError(500, `node lookup failed: ${nodeErr.message}`);
  const paperCheck = node ? timeAttackPaperCodeSchema.safeParse(node.paper_code) : null;
  if (!node || !paperCheck?.success) {
    throw badRequest("Time Attack is only available for GS-I or CSAT topics");
  }
  const paperCode = paperCheck.data;

  const subtree = await resolveSubtreeNodeIds(nodeId);
  const pool = await questionPool(paperCode, subtree);
  if (pool.length < TIME_ATTACK_SIZE) {
    throw badRequest(`Not enough questions for Time Attack (need ${TIME_ATTACK_SIZE}, have ${pool.length})`);
  }
  const picked = await pickRun(userId, pool);

  const { data: test, error: testErr } = await supabase()
    .from("tests")
    .insert({
      title_i18n: PAPER_TITLES[paperCode],
      kind: "time_attack",
      paper_code: paperCode,
      duration_minutes: TIME_ATTACK_MINUTES,
      total_marks: TIME_ATTACK_SIZE,
      is_published: true,
      meta: { source: "time_attack", node_id: nodeId, size: TIME_ATTACK_SIZE, marking_scheme: NO_NEGATIVE },
    })
    .select("id")
    .single();
  if (testErr) throw new HttpError(500, `time attack test insert failed: ${testErr.message}`);
  const testId = test.id as string;

  const rows = picked.map((q, i) => ({ test_id: testId, question_id: q.id, order_index: i, marks: 1 }));
  const { error: memErr } = await supabase().from("test_questions").insert(rows);
  if (memErr) throw new HttpError(500, `time attack membership insert failed: ${memErr.message}`);

  const attempt = await startAttempt(userId, { test_id: testId });
  void touchFeature(userId, "time_attack");
  const detail = await getTestDetail(testId);
  const answerKey: Record<string, string> = {};
  for (const q of picked) if (q.correct_option_key) answerKey[q.id] = q.correct_option_key;

  return { attempt_id: attempt.id, started_at: attempt.started_at, test: detail, answer_key: answerKey, node_id: nodeId };
}

export async function finishTimeAttack(userId: string, attemptId: string, comboBest: number): Promise<TimeAttackResult> {
  const { data: attempt, error: attErr } = await supabase()
    .from("attempts")
    .select("id, user_id, test_id, started_at, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (attErr) throw new HttpError(500, `attempt lookup failed: ${attErr.message}`);
  if (!attempt || attempt.user_id !== userId) throw notFound("Attempt not found");
  if (!attempt.submitted_at) throw badRequest("Time Attack run not submitted yet");

  const { data: testRow, error: testErr } = await supabase().from("tests").select("meta").eq("id", attempt.test_id).maybeSingle();
  if (testErr) throw new HttpError(500, `test lookup failed: ${testErr.message}`);
  const meta = (testRow?.meta ?? {}) as { node_id?: string; size?: number };
  const nodeId = meta.node_id;
  if (!nodeId) throw badRequest("Attempt is not a Time Attack run");
  const total = meta.size ?? TIME_ATTACK_SIZE;

  const { data: answers, error: ansErr } = await supabase()
    .from("attempt_answers")
    .select("is_correct")
    .eq("attempt_id", attemptId);
  if (ansErr) throw new HttpError(500, `answers lookup failed: ${ansErr.message}`);
  const correct = (answers ?? []).filter((a) => a.is_correct === true).length;

  const elapsed = Math.max(
    0,
    Math.round((Date.parse(attempt.submitted_at) - Date.parse(attempt.started_at)) / 1000),
  );
  const timeSeconds = Math.min(elapsed, TIME_ATTACK_MINUTES * 60);

  const { data: existing, error: bestErr } = await supabase()
    .from("personal_bests")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", "time_attack")
    .eq("syllabus_node_id", nodeId)
    .maybeSingle();
  if (bestErr) throw new HttpError(500, `personal best lookup failed: ${bestErr.message}`);

  const prev = mapPersonalBest(existing);
  // Better = more correct, tie broken by a faster time.
  const isNewBest =
    !prev ||
    correct > prev.best_correct ||
    (correct === prev.best_correct && prev.best_time_seconds !== null && timeSeconds < prev.best_time_seconds);

  let best = prev;
  if (isNewBest) {
    const { data: up, error: upErr } = await supabase()
      .from("personal_bests")
      .upsert(
        {
          user_id: userId,
          mode: "time_attack",
          syllabus_node_id: nodeId,
          best_correct: correct,
          best_total: total,
          best_time_seconds: timeSeconds,
          best_combo: comboBest,
          achieved_at: new Date().toISOString(),
        },
        { onConflict: "user_id,mode,syllabus_node_id" },
      )
      .select("*")
      .single();
    if (upErr) throw new HttpError(500, `personal best upsert failed: ${upErr.message}`);
    best = mapPersonalBest(up)!;
  }

  return {
    this_correct: correct,
    this_total: total,
    this_time_seconds: timeSeconds,
    this_combo: comboBest,
    personal_best: best!,
    is_new_best: isNewBest,
  };
}
