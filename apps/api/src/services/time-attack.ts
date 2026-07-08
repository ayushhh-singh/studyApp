/**
 * CSAT Time Attack. A rapid 10-question, 5-minute run over published CSAT MCQs
 * (whole paper or one CSAT node), with instant feedback + a combo on the client
 * and a personal best per node. Reuses the attempt engine (kind='time_attack',
 * no negative marking); the answer key is returned to the client on start because
 * this is a self-practice game, not an exam.
 */
import type { BilingualText, PersonalBest, TimeAttackResult, TimeAttackStart, TimeAttackTopic } from "@prayasup/shared";
import { TIME_ATTACK_MINUTES, TIME_ATTACK_SIZE } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import { getTestDetail } from "./tests.js";
import { startAttempt } from "./attempts.js";

const CSAT_PAPER = "PRE_CSAT";
const NO_NEGATIVE = { type: "time_attack", negative_marking: 0, note: "no negative marking" };

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface CsatQuestion {
  id: string;
  correct_option_key: string | null;
}

async function csatPool(nodeIds: string[]): Promise<CsatQuestion[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, correct_option_key")
    .eq("paper_code", CSAT_PAPER)
    .eq("type", "mcq")
    .eq("is_published", true)
    .in("syllabus_node_id", nodeIds);
  if (error) throw new HttpError(500, `CSAT question lookup failed: ${error.message}`);
  return (data ?? []) as CsatQuestion[];
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

/** The CSAT topics offerable for Time Attack: the paper root ("All CSAT") + any node with >= 10 published MCQs. */
export async function getTimeAttackTopics(userId: string): Promise<TimeAttackTopic[]> {
  const [nodesRes, questionsRes, bestsRes] = await Promise.all([
    supabase().from("syllabus_nodes").select("id, depth, path, title_i18n").eq("paper_code", CSAT_PAPER),
    supabase().from("questions").select("syllabus_node_id").eq("paper_code", CSAT_PAPER).eq("type", "mcq").eq("is_published", true).not("syllabus_node_id", "is", null),
    supabase().from("personal_bests").select("*").eq("user_id", userId).eq("mode", "time_attack"),
  ]);
  if (nodesRes.error) throw new HttpError(500, `CSAT node lookup failed: ${nodesRes.error.message}`);
  if (questionsRes.error) throw new HttpError(500, `CSAT question lookup failed: ${questionsRes.error.message}`);
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
  const bestByNode = new Map((bestsRes.data ?? []).map((b) => [b.syllabus_node_id as string, b]));

  // Root first (All CSAT), then depth-1 sections with enough supply, biggest first.
  const eligible = nodes
    .filter((n) => (n.depth === 0 || n.depth === 1) && (counts.get(n.id) ?? 0) >= TIME_ATTACK_SIZE)
    .sort((a, b) => a.depth - b.depth || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  return eligible.map((n) => ({
    node_id: n.id,
    title_i18n: n.title_i18n,
    available: counts.get(n.id) ?? 0,
    is_all_csat: n.depth === 0,
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
  if (!node || node.paper_code !== CSAT_PAPER) throw badRequest("Time Attack is only available for CSAT topics");

  const subtree = await resolveSubtreeNodeIds(nodeId);
  const pool = await csatPool(subtree);
  if (pool.length < TIME_ATTACK_SIZE) {
    throw badRequest(`Not enough CSAT questions for Time Attack (need ${TIME_ATTACK_SIZE}, have ${pool.length})`);
  }
  const picked = shuffle(pool).slice(0, TIME_ATTACK_SIZE);

  const { data: test, error: testErr } = await supabase()
    .from("tests")
    .insert({
      title_i18n: { en: "CSAT Time Attack", hi: "सीसैट टाइम अटैक" },
      kind: "time_attack",
      paper_code: CSAT_PAPER,
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
