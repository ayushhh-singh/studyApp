import type {
  BilingualText,
  ExamCode,
  ExamStage,
  NodeWeightage,
  PaperSummary,
  PaperTrends,
  SyllabusNode,
  SyllabusNodeDetail,
  SyllabusNodeWithStats,
  TrendNode,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import {
  byYearRecord,
  currentExamYear,
  DORMANT_YEARS,
  hotnessRaw,
  lastAskedYear,
  loadNodeWeightage,
  toNodeWeightage,
} from "../lib/weightage.js";

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
  const [rootsResult, topicsResult, questionsResult, notesResult, graded] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_stage, paper_code, title_i18n")
      .eq("depth", 0)
      .order("exam_stage", { ascending: true })
      .order("paper_code", { ascending: true }),
    supabase().from("syllabus_nodes").select("paper_code").eq("depth", 1),
    // Count only user-visible questions (published AND approved) that are
    // actually mapped to a syllabus_node_id, matching getPaperTree's
    // own_pyq_count rollup below (which skips null-node rows entirely) — a
    // needs_review row must not inflate the badge, and neither should
    // unmapped catalog content the outline view can never show under any
    // topic. Without the node-id filter this "N topics · M PYQs" hub count
    // disagreed with the outline's own total (529 vs 501 for PRE_GS1); "M
    // PYQs" is meant to describe PYQs actually distributed across those N
    // topics, not the raw unmapped catalog total.
    supabase()
      .from("questions")
      .select("paper_code")
      .eq("is_published", true)
      .eq("review_state", "approved")
      .not("syllabus_node_id", "is", null),
    // Published study notes per paper (via the node's paper_code) → coverage %.
    supabase().from("notes").select("syllabus_nodes(paper_code)").eq("status", "published"),
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

  const notesByPaper = new Map<string, number>();
  for (const row of notesResult.data ?? []) {
    // PostgREST embeds the to-one join as an object or a single-element array.
    const sn = (row as unknown as { syllabus_nodes: { paper_code: string } | { paper_code: string }[] | null })
      .syllabus_nodes;
    const code = Array.isArray(sn) ? sn[0]?.paper_code : sn?.paper_code;
    if (!code) continue;
    notesByPaper.set(code, (notesByPaper.get(code) ?? 0) + 1);
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
      notes_published_count: notesByPaper.get(root.paper_code) ?? 0,
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
export async function getPaperTree(
  userId: string,
  paperCode: string,
  exam?: ExamCode,
): Promise<SyllabusNodeWithStats> {
  let pyqQuery = supabase()
    .from("questions")
    .select("syllabus_node_id")
    .eq("paper_code", paperCode)
    .eq("is_published", true)
    .eq("review_state", "approved");
  if (exam) pyqQuery = pyqQuery.eq("exam_code", exam);

  const [treeResult, questionsResult, graded, weightage] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
      .eq("paper_code", paperCode)
      .order("depth", { ascending: true })
      .order("order_index", { ascending: true }),
    pyqQuery,
    getGradedAnswers(userId),
    loadNodeWeightage(exam),
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

  const cy = currentExamYear();

  // Post-order over the already-linked tree: each call returns the decorated
  // node plus its raw correct/total AND its rolled-up by-year weightage map, so
  // a parent rolls up its children's numbers directly from their return values.
  function decorate(
    node: SyllabusNode,
  ): { node: SyllabusNodeWithStats; correct: number; total: number; byYear: Map<number, number> } {
    const decoratedChildren = node.children.map(decorate);
    const own = ownStats.get(node.id) ?? { correct: 0, total: 0 };
    let correct = own.correct;
    let total = own.total;
    let pyq = ownPyqCount.get(node.id) ?? 0;
    const byYear = new Map<number, number>();
    for (const [y, c] of weightage.get(node.id)?.byYear ?? []) byYear.set(y, (byYear.get(y) ?? 0) + c);
    for (const child of decoratedChildren) {
      pyq += child.node.pyq_count;
      correct += child.correct;
      total += child.total;
      for (const [y, c] of child.byYear) byYear.set(y, (byYear.get(y) ?? 0) + c);
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
        // share_pct/hotness are normalised in a second pass once paper maxima
        // are known; set an unnormalised placeholder here.
        weightage: toNodeWeightage(byYear, cy, 0, 0),
        children: decoratedChildren.map((c) => c.node),
      },
      correct,
      total,
      byYear,
    };
  }

  const decoratedRoot = decorate(root).node;

  // Normalise share_pct/hotness against the busiest node in the paper, so the
  // bar and hotness read 0–100 relative to this paper's own top topic.
  let maxTotal = 0;
  let maxHot = 0;
  const walk = (n: SyllabusNodeWithStats, fn: (n: SyllabusNodeWithStats) => void) => {
    fn(n);
    n.children.forEach((c) => walk(c, fn));
  };
  walk(decoratedRoot, (n) => {
    if (!n.weightage) return;
    maxTotal = Math.max(maxTotal, n.weightage.total);
    const hot = hotnessRaw(recordToMap(n.weightage.by_year), cy);
    maxHot = Math.max(maxHot, hot);
  });
  walk(decoratedRoot, (n) => {
    if (!n.weightage) return;
    const hot = hotnessRaw(recordToMap(n.weightage.by_year), cy);
    n.weightage.share_pct = maxTotal > 0 ? Math.round((n.weightage.total / maxTotal) * 100) : 0;
    n.weightage.hotness = maxHot > 0 ? Math.round((hot / maxHot) * 100) : 0;
  });

  return decoratedRoot;
}

function recordToMap(rec: Record<string, number>): Map<number, number> {
  const m = new Map<number, number>();
  for (const [y, c] of Object.entries(rec)) m.set(Number(y), c);
  return m;
}

// ---------------------------------------------------------------------------
// Node detail — breadcrumb, own (exact-match) PYQ stats, related current
// affairs. "Own" stats deliberately match the /questions?node= filter
// exactly, so the PYQ count badge never disagrees with the list it labels.
// ---------------------------------------------------------------------------
export async function getNodeDetail(
  userId: string,
  nodeId: string,
  exam?: ExamCode,
): Promise<SyllabusNodeDetail> {
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

  // Subtree-aware: PYQs, current affairs, accuracy, and weightage all roll up
  // through this node's descendants, so a chapter (non-leaf) node shows its
  // sub-topics' content — and the pyq_count badge still matches the list it
  // labels. For a leaf, the subtree is just [node] (previous exact behaviour).
  const subtreeIds = await resolveSubtreeNodeIds(nodeId);
  const subtreeSet = new Set(subtreeIds);

  let pyqCountQuery = supabase()
    .from("questions")
    .select("id", { count: "exact", head: true })
    .in("syllabus_node_id", subtreeIds)
    .eq("is_published", true)
    .eq("review_state", "approved");
  if (exam) pyqCountQuery = pyqCountQuery.eq("exam_code", exam);

  // None of these depend on each other — only on nodeId/node.paper_code/
  // node.path (already in hand) and userId — so run them concurrently.
  const [ancestorResult, pyqCountResult, graded, weightageMap, relatedCaResult] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, title_i18n, path, depth")
      .eq("paper_code", node.paper_code)
      .in("path", prefixes),
    pyqCountQuery,
    getGradedAnswers(userId),
    loadNodeWeightage(exam),
    supabase()
      .from("current_affairs_items")
      .select(
        "id, date, category, is_up_specific, title_i18n, summary_i18n, detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids",
      )
      .eq("is_published", true)
      .overlaps("syllabus_node_ids", subtreeIds)
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
    const nid = row.questions?.syllabus_node_id;
    if (!nid || !subtreeSet.has(nid)) continue;
    total += 1;
    if (row.is_correct) correct += 1;
  }

  const relatedCa = relatedCaResult.data;
  const pyqCount = pyqCountResult.count;

  // Subtree weightage for this node (matches the subtree /questions?node= list
  // beside it). Self-normalised, so share_pct/hotness read 100 when data exists;
  // the node-detail chip uses total/last_asked_year/years_asked, not those two.
  const mergedByYear = new Map<number, number>();
  for (const id of subtreeIds) {
    const w = weightageMap.get(id);
    if (!w) continue;
    for (const [year, count] of w.byYear) mergedByYear.set(year, (mergedByYear.get(year) ?? 0) + count);
  }
  const cy = currentExamYear();
  const subtreeTotal = [...mergedByYear.values()].reduce((a, b) => a + b, 0);
  const nodeWeightage: NodeWeightage | null =
    subtreeTotal > 0 ? toNodeWeightage(mergedByYear, cy, subtreeTotal, hotnessRaw(mergedByYear, cy)) : null;

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
    weightage: nodeWeightage,
    related_current_affairs: (relatedCa ?? []) as unknown as SyllabusNodeDetail["related_current_affairs"],
  };
}

// ---------------------------------------------------------------------------
// Per-paper Trends — the weightage analytics view. Rolls the cached per-node
// aggregates up the tree, then surfaces the busiest topics, the recency-hot
// ("rising") topics, and topics gone quiet for 5+ years ("dormant"). Computed
// from the matview + syllabus tree, so it's cheap.
// ---------------------------------------------------------------------------
export async function getPaperTrends(paperCode: string, exam?: ExamCode): Promise<PaperTrends> {
  const [treeResult, weightage] = await Promise.all([
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
      .eq("paper_code", paperCode)
      .order("depth", { ascending: true })
      .order("order_index", { ascending: true }),
    loadNodeWeightage(exam),
  ]);
  if (treeResult.error) throw new HttpError(500, `paper trends lookup failed: ${treeResult.error.message}`);
  const rows = (treeResult.data ?? []) as SyllabusRow[];
  const [root] = buildTree(rows);
  if (!root) throw notFound("Paper not found");

  const cy = currentExamYear();

  // Roll each node's own by-year counts up through its subtree.
  const rolled = new Map<string, { node: SyllabusNode; byYear: Map<number, number> }>();
  function roll(node: SyllabusNode): Map<number, number> {
    const byYear = new Map<number, number>();
    for (const [y, c] of weightage.get(node.id)?.byYear ?? []) byYear.set(y, (byYear.get(y) ?? 0) + c);
    for (const child of node.children) for (const [y, c] of roll(child)) byYear.set(y, (byYear.get(y) ?? 0) + c);
    rolled.set(node.id, { node, byYear });
    return byYear;
  }
  roll(root);

  // Paper-wide series: sum OWN counts across THIS PAPER's nodes only (the
  // matview spans every paper, so scope by the paper's node ids). Own counts,
  // not rolled, to avoid double-counting ancestors.
  const paperNodeIds = new Set(rows.map((r) => r.id));
  const totalByYear = new Map<number, number>();
  for (const nodeId of paperNodeIds) {
    for (const [y, c] of weightage.get(nodeId)?.byYear ?? []) totalByYear.set(y, (totalByYear.get(y) ?? 0) + c);
  }
  const totalQuestions = [...totalByYear.values()].reduce((a, b) => a + b, 0);

  // Year axis: the last 10 years up to the latest asked year (or current year).
  const latestYear = totalByYear.size ? Math.max(...totalByYear.keys()) : cy;
  const years: number[] = [];
  for (let y = latestYear - 9; y <= latestYear; y++) years.push(y);

  // Candidate trend nodes: depth >= 1 (skip the paper root), with data.
  const candidates: (TrendNode & { hotRaw: number })[] = [];
  for (const { node, byYear } of rolled.values()) {
    if (node.depth === 0) continue;
    const total = [...byYear.values()].reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const hotRaw = hotnessRaw(byYear, cy);
    candidates.push({
      node_id: node.id,
      title_i18n: node.title_i18n,
      path: node.path,
      depth: node.depth,
      total,
      by_year: byYearRecord(byYear),
      last_asked_year: lastAskedYear(byYear),
      years_asked: byYear.size,
      hotness: 0, // normalised below
      hotRaw,
    });
  }
  const maxHot = candidates.reduce((m, c) => Math.max(m, c.hotRaw), 0);
  for (const c of candidates) c.hotness = maxHot > 0 ? Math.round((c.hotRaw / maxHot) * 100) : 0;

  const strip = ({ hotRaw: _hotRaw, ...rest }: TrendNode & { hotRaw: number }): TrendNode => rest;

  const topNodes = [...candidates].sort((a, b) => b.total - a.total || b.hotRaw - a.hotRaw).slice(0, 12).map(strip);
  const rising = [...candidates]
    .filter((c) => c.last_asked_year !== null && c.last_asked_year >= cy - 3)
    .sort((a, b) => b.hotRaw - a.hotRaw)
    .slice(0, 8)
    .map(strip);
  const dormant = [...candidates]
    .filter((c) => c.last_asked_year !== null && c.last_asked_year <= cy - DORMANT_YEARS)
    .sort((a, b) => b.total - a.total || (a.last_asked_year ?? 0) - (b.last_asked_year ?? 0))
    .slice(0, 8)
    .map(strip);

  return {
    paper_code: paperCode,
    exam_code: exam ?? null,
    years,
    total_by_year: byYearRecord(totalByYear),
    total_questions: totalQuestions,
    top_nodes: topNodes,
    rising,
    dormant,
  };
}
