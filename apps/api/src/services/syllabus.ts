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
  // depth=1 rows are the top-level chapters shown as the outline's first
  // level (what "N topics" on a paper card should count) — NOT every node at
  // every depth, which would silently include every subtopic too.
  const [rootsResult, topicsResult, questionsResult, graded] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_stage, paper_code, title_i18n")
      .eq("depth", 0)
      .order("exam_stage", { ascending: true })
      .order("paper_code", { ascending: true }),
    supabase().from("syllabus_nodes").select("paper_code").eq("depth", 1),
    supabase().from("questions").select("paper_code").eq("is_published", true),
    getGradedAnswers(userId),
  ]);
  if (rootsResult.error) throw new HttpError(500, `paper roots lookup failed: ${rootsResult.error.message}`);
  if (topicsResult.error) throw new HttpError(500, `topic count lookup failed: ${topicsResult.error.message}`);
  if (questionsResult.error) throw new HttpError(500, `question count lookup failed: ${questionsResult.error.message}`);

  const rootRows = (rootsResult.data ?? []) as {
    id: string;
    exam_stage: ExamStage;
    paper_code: string;
    title_i18n: BilingualText;
  }[];

  const topicsByPaper = new Map<string, number>();
  for (const row of topicsResult.data ?? []) {
    const code = row.paper_code as string;
    topicsByPaper.set(code, (topicsByPaper.get(code) ?? 0) + 1);
  }

  const pyqByPaper = new Map<string, number>();
  for (const row of questionsResult.data ?? []) {
    const code = row.paper_code as string;
    pyqByPaper.set(code, (pyqByPaper.get(code) ?? 0) + 1);
  }

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
// Paper outline — full node tree for one paper, annotated with both:
//  - own_pyq_count: PYQs mapped exactly to that node (matches /questions?node=)
//  - pyq_count/accuracy_pct/answered_count: rolled up through the whole
//    subtree, so a chapter row is meaningful even though only leaf topics
//    carry questions directly.
// ---------------------------------------------------------------------------
export async function getPaperTree(userId: string, paperCode: string): Promise<SyllabusNodeWithStats> {
  const [treeResult, questionsResult, graded] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
      .eq("paper_code", paperCode)
      .order("depth", { ascending: true })
      .order("order_index", { ascending: true }),
    supabase().from("questions").select("syllabus_node_id").eq("paper_code", paperCode).eq("is_published", true),
    getGradedAnswers(userId),
  ]);
  if (treeResult.error) throw new HttpError(500, `paper tree lookup failed: ${treeResult.error.message}`);
  if (questionsResult.error) throw new HttpError(500, `paper question lookup failed: ${questionsResult.error.message}`);

  const rows = (treeResult.data ?? []) as SyllabusRow[];
  const [root] = buildTree(rows);
  if (!root) throw notFound("Paper not found");

  const ownPyqCount = new Map<string, number>();
  for (const row of questionsResult.data ?? []) {
    const nodeId = row.syllabus_node_id as string | null;
    if (!nodeId) continue;
    ownPyqCount.set(nodeId, (ownPyqCount.get(nodeId) ?? 0) + 1);
  }

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

  // Post-order over the already-linked tree: each call returns both the
  // decorated node and its raw correct/total, so a parent can roll up its
  // children's totals directly from their return values — no side Map needed.
  function decorate(node: SyllabusNode): { node: SyllabusNodeWithStats; correct: number; total: number } {
    const decoratedChildren = node.children.map(decorate);
    const own = ownStats.get(node.id) ?? { correct: 0, total: 0 };
    let correct = own.correct;
    let total = own.total;
    let pyq = ownPyqCount.get(node.id) ?? 0;
    for (const child of decoratedChildren) {
      pyq += child.node.pyq_count;
      correct += child.correct;
      total += child.total;
    }
    return {
      node: {
        id: node.id,
        exam_stage: node.exam_stage,
        paper_code: node.paper_code,
        title_i18n: node.title_i18n,
        description_i18n: node.description_i18n,
        order_index: node.order_index,
        depth: node.depth,
        path: node.path,
        own_pyq_count: ownPyqCount.get(node.id) ?? 0,
        pyq_count: pyq,
        accuracy_pct: total > 0 ? round2((correct / total) * 100) : null,
        answered_count: total,
        children: decoratedChildren.map((c) => c.node),
      },
      correct,
      total,
    };
  }

  return decorate(root).node;
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

  // None of these four depend on each other — only on nodeId/node.paper_code/
  // node.path (already in hand) and userId — so run them concurrently.
  const [ancestorResult, pyqCountResult, graded, relatedCaResult] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, title_i18n, path, depth")
      .eq("paper_code", node.paper_code)
      .in("path", prefixes),
    supabase()
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("syllabus_node_id", nodeId)
      .eq("is_published", true),
    getGradedAnswers(userId),
    supabase()
      .from("current_affairs_items")
      .select(
        "id, date, category, is_up_specific, title_i18n, summary_i18n, detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids",
      )
      .eq("is_published", true)
      .contains("syllabus_node_ids", [nodeId])
      .order("date", { ascending: false })
      .limit(10),
  ]);
  if (ancestorResult.error) throw new HttpError(500, `breadcrumb lookup failed: ${ancestorResult.error.message}`);
  if (pyqCountResult.error) throw new HttpError(500, `node question count failed: ${pyqCountResult.error.message}`);
  if (relatedCaResult.error) {
    throw new HttpError(500, `related current affairs lookup failed: ${relatedCaResult.error.message}`);
  }

  const breadcrumb = (
    (ancestorResult.data ?? []) as { id: string; title_i18n: BilingualText; path: string; depth: number }[]
  )
    .sort((a, b) => a.depth - b.depth)
    .map((r) => ({ id: r.id, title_i18n: r.title_i18n, path: r.path }));

  let correct = 0;
  let total = 0;
  for (const row of graded) {
    if (row.questions?.syllabus_node_id !== nodeId) continue;
    total += 1;
    if (row.is_correct) correct += 1;
  }

  const relatedCa = relatedCaResult.data;
  const pyqCount = pyqCountResult.count;

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
