import type {
  BilingualText,
  ExamStage,
  PaperSummary,
  SyllabusNode,
  SyllabusNodeDetail,
  SyllabusNodeWithStats,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { getGradedAnswers } from "../lib/graded-answers.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface SyllabusRow {
  id: string;
  exam_stage: ExamStage;
  paper_code: string;
  title_i18n: SyllabusNode["title_i18n"];
  description_i18n: SyllabusNode["description_i18n"];
  order_index: number;
  depth: number;
  path: string;
  parent_id: string | null;
}

function buildTree(rows: SyllabusRow[]): SyllabusNode[] {
  const byId = new Map<string, SyllabusNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      exam_stage: r.exam_stage,
      paper_code: r.paper_code,
      title_i18n: r.title_i18n,
      description_i18n: r.description_i18n,
      order_index: r.order_index,
      depth: r.depth,
      path: r.path,
      children: [],
    });
  }
  const roots: SyllabusNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getSyllabusTree(stage?: ExamStage): Promise<SyllabusNode[]> {
  let query = supabase()
    .from("syllabus_nodes")
    .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
    .order("paper_code", { ascending: true })
    .order("order_index", { ascending: true });
  if (stage) query = query.eq("exam_stage", stage);

  const { data, error } = await query;
  if (error) throw new HttpError(500, `syllabus query failed: ${error.message}`);
  return buildTree((data ?? []) as SyllabusRow[]);
}

// ---------------------------------------------------------------------------
// Papers grid — one row per paper root (syllabus_nodes.depth = 0).
// ---------------------------------------------------------------------------
export async function getPaperSummaries(userId: string): Promise<PaperSummary[]> {
  const { data: roots, error: rootsError } = await supabase()
    .from("syllabus_nodes")
    .select("id, exam_stage, paper_code, title_i18n")
    .eq("depth", 0)
    .order("exam_stage", { ascending: true })
    .order("paper_code", { ascending: true });
  if (rootsError) throw new HttpError(500, `paper roots lookup failed: ${rootsError.message}`);
  const rootRows = (roots ?? []) as {
    id: string;
    exam_stage: ExamStage;
    paper_code: string;
    title_i18n: BilingualText;
  }[];

  const { data: topicRows, error: topicsError } = await supabase()
    .from("syllabus_nodes")
    .select("paper_code")
    .gt("depth", 0);
  if (topicsError) throw new HttpError(500, `topic count lookup failed: ${topicsError.message}`);
  const topicsByPaper = new Map<string, number>();
  for (const row of topicRows ?? []) {
    const code = row.paper_code as string;
    topicsByPaper.set(code, (topicsByPaper.get(code) ?? 0) + 1);
  }

  const { data: questionRows, error: questionsError } = await supabase()
    .from("questions")
    .select("paper_code")
    .eq("is_published", true);
  if (questionsError) throw new HttpError(500, `question count lookup failed: ${questionsError.message}`);
  const pyqByPaper = new Map<string, number>();
  for (const row of questionRows ?? []) {
    const code = row.paper_code as string;
    pyqByPaper.set(code, (pyqByPaper.get(code) ?? 0) + 1);
  }

  const graded = await getGradedAnswers(userId);
  const accuracyByPaper = new Map<string, { correct: number; total: number }>();
  for (const row of graded) {
    const code = row.questions?.paper_code;
    if (!code) continue;
    const bucket = accuracyByPaper.get(code) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (row.is_correct) bucket.correct += 1;
    accuracyByPaper.set(code, bucket);
  }

  return rootRows.map((root) => {
    const stats = accuracyByPaper.get(root.paper_code);
    return {
      paper_code: root.paper_code,
      exam_stage: root.exam_stage,
      title_i18n: root.title_i18n,
      topics_count: topicsByPaper.get(root.paper_code) ?? 0,
      pyq_count: pyqByPaper.get(root.paper_code) ?? 0,
      accuracy_pct: stats && stats.total > 0 ? round2((stats.correct / stats.total) * 100) : null,
      answered_count: stats?.total ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Paper outline — full node tree for one paper, annotated with subtree-wide
// PYQ counts + accuracy (own question stats rolled up through every ancestor,
// so a chapter row is meaningful even though only leaf topics carry
// questions directly).
// ---------------------------------------------------------------------------
interface PaperTreeRow {
  id: string;
  exam_stage: ExamStage;
  paper_code: string;
  title_i18n: BilingualText;
  description_i18n: BilingualText | null;
  order_index: number;
  depth: number;
  path: string;
  parent_id: string | null;
}

export async function getPaperTree(userId: string, paperCode: string): Promise<SyllabusNodeWithStats> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
    .eq("paper_code", paperCode)
    .order("depth", { ascending: true })
    .order("order_index", { ascending: true });
  if (error) throw new HttpError(500, `paper tree lookup failed: ${error.message}`);
  const rows = (data ?? []) as PaperTreeRow[];
  const root = rows.find((r) => r.depth === 0);
  if (!root) throw notFound("Paper not found");

  const { data: questionRows, error: qError } = await supabase()
    .from("questions")
    .select("syllabus_node_id")
    .eq("paper_code", paperCode)
    .eq("is_published", true);
  if (qError) throw new HttpError(500, `paper question lookup failed: ${qError.message}`);
  const ownPyqCount = new Map<string, number>();
  for (const row of questionRows ?? []) {
    const nodeId = row.syllabus_node_id as string | null;
    if (!nodeId) continue;
    ownPyqCount.set(nodeId, (ownPyqCount.get(nodeId) ?? 0) + 1);
  }

  const graded = await getGradedAnswers(userId);
  const ownStats = new Map<string, { correct: number; total: number }>();
  for (const row of graded) {
    if (row.questions?.paper_code !== paperCode) continue;
    const nodeId = row.questions?.syllabus_node_id;
    if (!nodeId) continue;
    const bucket = ownStats.get(nodeId) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (row.is_correct) bucket.correct += 1;
    ownStats.set(nodeId, bucket);
  }

  const byId = new Map<string, SyllabusNodeWithStats>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      exam_stage: r.exam_stage,
      paper_code: r.paper_code,
      title_i18n: r.title_i18n,
      description_i18n: r.description_i18n,
      order_index: r.order_index,
      depth: r.depth,
      path: r.path,
      pyq_count: 0,
      accuracy_pct: null,
      answered_count: 0,
      children: [],
    });
  }
  for (const r of rows) {
    if (!r.parent_id) continue;
    const parent = byId.get(r.parent_id);
    if (parent) parent.children.push(byId.get(r.id)!);
  }

  // Deepest-first so every node's children are already fully accumulated
  // (pyq_count + correct/total) by the time the node itself is processed.
  const subtreeTotals = new Map<string, { correct: number; total: number }>();
  for (const r of [...rows].sort((a, b) => b.depth - a.depth)) {
    const node = byId.get(r.id)!;
    const own = ownStats.get(r.id) ?? { correct: 0, total: 0 };
    let correct = own.correct;
    let total = own.total;
    let pyq = ownPyqCount.get(r.id) ?? 0;
    for (const child of node.children) {
      pyq += child.pyq_count;
      const childTotals = subtreeTotals.get(child.id);
      if (childTotals) {
        correct += childTotals.correct;
        total += childTotals.total;
      }
    }
    node.pyq_count = pyq;
    node.answered_count = total;
    node.accuracy_pct = total > 0 ? round2((correct / total) * 100) : null;
    subtreeTotals.set(r.id, { correct, total });
  }

  return byId.get(root.id)!;
}

// ---------------------------------------------------------------------------
// Node detail — breadcrumb, own (exact-match) PYQ stats, related current
// affairs. "Own" stats deliberately match the /questions?node= filter
// exactly, so the PYQ count badge never disagrees with the list it labels.
// ---------------------------------------------------------------------------
export async function getNodeDetail(userId: string, nodeId: string): Promise<SyllabusNodeDetail> {
  const { data: node, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, exam_stage, paper_code, title_i18n, description_i18n, path")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw new HttpError(500, `syllabus node lookup failed: ${error.message}`);
  if (!node) throw notFound("Syllabus node not found");

  const segments = node.path ? (node.path as string).split("/") : [];
  const prefixes = [""];
  for (let i = 1; i <= segments.length; i++) prefixes.push(segments.slice(0, i).join("/"));

  const { data: ancestorRows, error: ancestorError } = await supabase()
    .from("syllabus_nodes")
    .select("id, title_i18n, path, depth")
    .eq("paper_code", node.paper_code)
    .in("path", prefixes);
  if (ancestorError) throw new HttpError(500, `breadcrumb lookup failed: ${ancestorError.message}`);
  const breadcrumb = (
    (ancestorRows ?? []) as { id: string; title_i18n: BilingualText; path: string; depth: number }[]
  )
    .sort((a, b) => a.depth - b.depth)
    .map((r) => ({ id: r.id, title_i18n: r.title_i18n, path: r.path }));

  const { count: pyqCount, error: qError } = await supabase()
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("syllabus_node_id", nodeId)
    .eq("is_published", true);
  if (qError) throw new HttpError(500, `node question count failed: ${qError.message}`);

  const graded = await getGradedAnswers(userId);
  let correct = 0;
  let total = 0;
  for (const row of graded) {
    if (row.questions?.syllabus_node_id !== nodeId) continue;
    total += 1;
    if (row.is_correct) correct += 1;
  }

  const { data: relatedCa, error: caError } = await supabase()
    .from("current_affairs_items")
    .select(
      "id, date, category, is_up_specific, title_i18n, summary_i18n, detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids",
    )
    .eq("is_published", true)
    .contains("syllabus_node_ids", [nodeId])
    .order("date", { ascending: false })
    .limit(10);
  if (caError) throw new HttpError(500, `related current affairs lookup failed: ${caError.message}`);

  return {
    id: node.id,
    exam_stage: node.exam_stage as ExamStage,
    paper_code: node.paper_code as string,
    title_i18n: node.title_i18n as BilingualText,
    description_i18n: node.description_i18n as BilingualText | null,
    breadcrumb,
    pyq_count: pyqCount ?? 0,
    accuracy_pct: total > 0 ? round2((correct / total) * 100) : null,
    answered_count: total,
    related_current_affairs: (relatedCa ?? []) as unknown as SyllabusNodeDetail["related_current_affairs"],
  };
}
