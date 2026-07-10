/**
 * Mastery engine compute + read. `recomputeMastery` derives a mastery score for
 * every syllabus node the user has practised (rolled up the materialized-path
 * tree, so a section aggregates all its topics' answers) and upserts node_mastery.
 * `getMasteryMap` reads those rows annotated with PYQ weight for the Conquest Map.
 *
 * Runs after each attempt submit (best-effort) and nightly — see daily/scheduler.
 */
import type { BilingualText, ExamCode, MasteryMap, MasteryNode } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { HttpError } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { daysSince, masteryLevel, masteryScore, MASTERY_CONFIG } from "./config.js";

/**
 * All node paths a question at `path` contributes to: itself, every ancestor
 * segment, and the paper root (""). A materialized path has no parent-chain
 * query, so we roll up by prefix.
 */
function ancestorPaths(path: string): string[] {
  if (!path) return [""];
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(0, i + 1).join("/"));
  out.push(""); // paper root
  return out;
}

const pk = (paperCode: string, path: string) => `${paperCode} ${path}`;

interface NodeRow {
  id: string;
  paper_code: string;
  parent_id: string | null;
  title_i18n: BilingualText;
  depth: number;
  path: string;
  order_index: number;
}

interface Bucket {
  attempted: number;
  correct: number;
  lastTs: string | null;
}

/**
 * Recompute and persist mastery for every node the user has graded answers in.
 * Idempotent: upserts on (user_id, node). Decay is time-based, so re-running
 * (nightly) is what keeps an untouched Gold node fading toward Silver.
 */
export async function recomputeMastery(userId: string): Promise<number> {
  // 1) submitted attempts (id -> submitted_at, the "when practised" timestamp).
  const { data: attempts, error: aErr } = await supabase()
    .from("attempts")
    .select("id, submitted_at")
    .eq("user_id", userId)
    .not("submitted_at", "is", null);
  if (aErr) throw new HttpError(500, `attempt lookup failed: ${aErr.message}`);
  const submittedAt = new Map((attempts ?? []).map((r) => [r.id as string, r.submitted_at as string]));
  const attemptIds = [...submittedAt.keys()];
  if (attemptIds.length === 0) return 0;

  // 2) graded answers joined to their question's node.
  const { data: answers, error: ansErr } = await supabase()
    .from("attempt_answers")
    .select("attempt_id, is_correct, questions(paper_code, syllabus_node_id)")
    .in("attempt_id", attemptIds)
    .not("is_correct", "is", null);
  if (ansErr) throw new HttpError(500, `graded answer lookup failed: ${ansErr.message}`);
  const rows = (answers ?? []) as unknown as {
    attempt_id: string;
    is_correct: boolean;
    questions: { paper_code: string; syllabus_node_id: string | null } | null;
  }[];

  const paperCodes = [...new Set(rows.map((r) => r.questions?.paper_code).filter((c): c is string => !!c))];
  if (paperCodes.length === 0) return 0;

  // 3) node registry for the involved papers, so we can resolve ancestor paths.
  const { data: nodes, error: nErr } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, path")
    .in("paper_code", paperCodes);
  if (nErr) throw new HttpError(500, `node lookup failed: ${nErr.message}`);
  const idByPaperPath = new Map<string, string>();
  const pathById = new Map<string, { paper_code: string; path: string }>();
  for (const n of (nodes ?? []) as { id: string; paper_code: string; path: string }[]) {
    idByPaperPath.set(pk(n.paper_code, n.path), n.id);
    pathById.set(n.id, { paper_code: n.paper_code, path: n.path });
  }

  // 4) accumulate per node (rolled up through ancestors).
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const nid = r.questions?.syllabus_node_id;
    const paper = r.questions?.paper_code;
    if (!nid || !paper) continue;
    const leaf = pathById.get(nid);
    if (!leaf) continue;
    const ts = submittedAt.get(r.attempt_id) ?? null;
    for (const ap of ancestorPaths(leaf.path)) {
      const ancId = idByPaperPath.get(pk(paper, ap));
      if (!ancId) continue;
      const b = buckets.get(ancId) ?? { attempted: 0, correct: 0, lastTs: null };
      b.attempted += 1;
      if (r.is_correct) b.correct += 1;
      if (ts && (!b.lastTs || ts > b.lastTs)) b.lastTs = ts;
      buckets.set(ancId, b);
    }
  }
  if (buckets.size === 0) return 0;

  // 5) score + upsert.
  const now = Date.now();
  const upserts = [...buckets.entries()].map(([nodeId, b]) => {
    const days = b.lastTs ? daysSince(b.lastTs, now) : Infinity;
    const score = masteryScore(b.correct, b.attempted, days);
    const level = masteryLevel(score, b.attempted);
    return {
      user_id: userId,
      syllabus_node_id: nodeId,
      level,
      score,
      computed_at: new Date(now).toISOString(),
      meta: {
        attempted: b.attempted,
        correct: b.correct,
        accuracy: b.attempted ? Math.round((b.correct / b.attempted) * 1000) / 1000 : 0,
        days_since_last: Number.isFinite(days) ? Math.round(days * 10) / 10 : null,
        last_practiced_at: b.lastTs,
      },
    };
  });

  const { error: upErr } = await supabase()
    .from("node_mastery")
    .upsert(upserts, { onConflict: "user_id,syllabus_node_id" });
  if (upErr) throw new HttpError(500, `mastery upsert failed: ${upErr.message}`);
  return upserts.length;
}

// ---------------------------------------------------------------------------
// Read side — the Conquest Map payload.
// ---------------------------------------------------------------------------

/** Fraction of a paper's high-weight sections that get the "study next" pulse. */
const HIGH_WEIGHT_FRACTION = 0.4;

export async function getMasteryMap(userId: string, paperCode?: string, exam?: ExamCode): Promise<MasteryMap> {
  let nodeQuery = supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, parent_id, title_i18n, depth, path, order_index");
  if (paperCode) nodeQuery = nodeQuery.eq("paper_code", paperCode);
  const { data: nodeData, error: nErr } = await nodeQuery;
  if (nErr) throw new HttpError(500, `node lookup failed: ${nErr.message}`);
  const nodes = (nodeData ?? []) as NodeRow[];
  if (nodes.length === 0) return { paper_code: paperCode ?? null, total_pyq_count: 0, nodes: [] };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const idByPaperPath = new Map<string, string>();
  for (const n of nodes) idByPaperPath.set(pk(n.paper_code, n.path), n.id);
  const nodeIds = nodes.map((n) => n.id);
  const papers = [...new Set(nodes.map((n) => n.paper_code))];

  // Mastery rows + PYQ counts (subtree) in parallel.
  const [masteryRes, questionRows] = await Promise.all([
    supabase().from("node_mastery").select("syllabus_node_id, level, score, meta").eq("user_id", userId).in("syllabus_node_id", nodeIds),
    // Paginate: weight counts EVERY published question in scope; across all
    // papers this exceeds 1000, so a single select truncated tile weights.
    selectAll<{ paper_code: string; syllabus_node_id: string }>(() => {
      // Weight (PYQ count/tile sizing) is a content-classification stat, not
      // an accuracy one — it must count descriptive PYQs too, or every Mains
      // paper's Conquest Map (all-descriptive) renders as permanently empty
      // regardless of drill depth. The *mastery level* rows queried above
      // stay MCQ-only correctly (they come from attempt_answers, which has
      // no descriptive analogue) — a Mains tile just shows its real weight
      // colored "unseen" until this app has some other graded signal for it.
      let q = supabase()
        .from("questions")
        .select("paper_code, syllabus_node_id")
        .not("syllabus_node_id", "is", null)
        .or(questionVisibilityOrFilter("catalog"));
      if (paperCode) q = q.eq("paper_code", paperCode);
      else q = q.in("paper_code", papers);
      // Matches the same `exam` filter the Outline view applies (getNodeDetail's
      // pyqCountQuery) — without this, switching to Map view silently dropped
      // the filter: tile sizing/weight always reflected ALL exams regardless
      // of what "UPPSC only" showed a moment ago in Outline for the same paper.
      if (exam) q = q.eq("exam_code", exam);
      return q.order("id", { ascending: true });
    }),
  ]);
  if (masteryRes.error) throw new HttpError(500, `mastery lookup failed: ${masteryRes.error.message}`);

  const masteryByNode = new Map(
    (masteryRes.data ?? []).map((r) => [
      r.syllabus_node_id as string,
      { level: r.level as MasteryNode["mastery_level"], score: Number(r.score), attempted: ((r.meta as { attempted?: number } | null)?.attempted ?? 0) },
    ]),
  );

  // Subtree PYQ counts by node (roll each question up its ancestor paths).
  const pyqByNode = new Map<string, number>();
  const totalByPaper = new Map<string, number>();
  for (const r of questionRows as { paper_code: string; syllabus_node_id: string }[]) {
    const leaf = nodeById.get(r.syllabus_node_id);
    if (!leaf) continue;
    totalByPaper.set(leaf.paper_code, (totalByPaper.get(leaf.paper_code) ?? 0) + 1);
    for (const ap of ancestorPaths(leaf.path)) {
      const ancId = idByPaperPath.get(pk(leaf.paper_code, ap));
      if (ancId) pyqByNode.set(ancId, (pyqByNode.get(ancId) ?? 0) + 1);
    }
  }
  const totalPyq = paperCode ? (totalByPaper.get(paperCode) ?? 0) : [...totalByPaper.values()].reduce((s, v) => s + v, 0);

  // High-weight depth-1 sections (per paper) get the pulse when still weak.
  const highWeightIds = new Set<string>();
  for (const paper of papers) {
    const sections = nodes
      .filter((n) => n.paper_code === paper && n.depth === 1 && (pyqByNode.get(n.id) ?? 0) > 0)
      .sort((a, b) => (pyqByNode.get(b.id) ?? 0) - (pyqByNode.get(a.id) ?? 0));
    const cut = Math.max(1, Math.ceil(sections.length * HIGH_WEIGHT_FRACTION));
    for (const n of sections.slice(0, cut)) highWeightIds.add(n.id);
  }

  const out: MasteryNode[] = nodes.map((n) => {
    const m = masteryByNode.get(n.id);
    const pyq = pyqByNode.get(n.id) ?? 0;
    const paperTotal = totalByPaper.get(n.paper_code) ?? 0;
    const level = m?.level ?? "unseen";
    const weak = level !== "gold" && level !== "exam_ready";
    return {
      id: n.id,
      parent_id: n.parent_id,
      title_i18n: n.title_i18n,
      depth: n.depth,
      path: n.path,
      order_index: n.order_index,
      pyq_count: pyq,
      weight_pct: paperTotal > 0 ? Math.round((pyq / paperTotal) * 1000) / 10 : 0,
      mastery_level: level,
      mastery_score: m?.score ?? 0,
      attempted: m?.attempted ?? 0,
      is_priority: n.depth === 1 && weak && highWeightIds.has(n.id),
    };
  });

  return { paper_code: paperCode ?? null, total_pyq_count: totalPyq, nodes: out };
}
