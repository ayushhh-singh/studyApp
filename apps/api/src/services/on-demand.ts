/**
 * "Show me a new set" — the SELECTION half of the demand-aware reserve.
 *
 * This is NEVER a live synchronous generation call. qgen/generate.ts inserts
 * every question review-gated (review_state='needs_review', is_published=false),
 * with no auto-publish path — so a live request could never wait for a human to
 * approve. Instead this builds a fresh set INSTANTLY from already
 * published+approved questions the user hasn't recently seen — real PYQs first,
 * then the AI-generated reserve, then overlapping current-affairs MCQs — exactly
 * like the existing "build from question bank" path, just recency-excluded so it
 * feels genuinely new. Every request is logged as a demand signal
 * (on_demand_requests) that qgen/topup.ts reads nightly to keep that reserve
 * stocked. When the reserve genuinely can't fill a niche scope yet, the user is
 * told honestly ("we're preparing more") and their request feeds tonight's
 * top-up — never a synchronous fallback, never a skipped review gate.
 *
 * The review-gate quality bar is preserved throughout: every syllabus question
 * this selects goes through questionVisibilityOrFilter (published + approved).
 * The only exception is the current-affairs pool, which is admitted via the
 * SAME "test" scope + CURRENT_AFFAIRS exception the "Quiz me on this week" test
 * already uses (see lib/question-visibility.ts) — CA's own serving surface.
 */
import type {
  BilingualText,
  CreateFreshCustomSetBody,
  CreateFreshMockSetBody,
  Difficulty,
  ExamCode,
  FreshSetResult,
  TestDetail,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { logger } from "../lib/logger.js";
import { roundMarks, DEFAULT_MCQ_MARKS } from "../lib/marks.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import {
  CURRENT_AFFAIRS_PAPER_CODE,
  questionVisibilityOrFilter,
  UPPSC_EXAM_CODE,
  type QuestionVisibilityScope,
} from "../lib/question-visibility.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear, type OwnWeightage } from "../lib/weightage.js";
import { assertMockTests } from "./entitlements.js";
import { touchFeature } from "../lib/feature-touch.js";
import { getTestDetail } from "./tests.js";
import {
  availableMockPool,
  freshMockPaperConfig,
  sectionHotness,
  weightedSample,
  type AvailQ,
} from "./mocks.js";

/**
 * How far back a question counts as "recently seen" and is therefore excluded
 * from a fresh set. 30 days matches the reserve window (on-demand-reserve.ts):
 * long enough that a fresh set genuinely feels new across a study cycle, short
 * enough that a limited bank isn't permanently exhausted — a question recycles
 * after a month.
 */
const SEEN_WINDOW_DAYS = 30;

const DAY_MS = 24 * 3600 * 1000;

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Demand log (the signal qgen/topup.ts reads) — deduped per user/node/scope/day
// ---------------------------------------------------------------------------

/**
 * Record demand for a scope. Deduped by the (user, node, scope, IST day) unique
 * index (0101): repeatedly clicking the same scope the same day can't inflate
 * the signal. Best-effort — a demand-log failure never fails the user's build.
 */
async function logDemand(
  userId: string,
  nodeIds: string[],
  scopeType: "custom" | "mock",
  exam: string | null,
): Promise<void> {
  const rows = [...new Set(nodeIds)].map((node_id) => ({
    user_id: userId,
    node_id,
    scope_type: scopeType,
    exam,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase()
    .from("on_demand_requests")
    // requested_on is DB-defaulted to the IST day; the unique index catches a
    // same-day repeat, and ignoreDuplicates makes that a silent no-op.
    .upsert(rows, { onConflict: "user_id,node_id,scope_type,requested_on", ignoreDuplicates: true });
  if (error) logger.warn({ err: error, scopeType }, "on-demand: demand log failed (non-fatal)");
}

// ---------------------------------------------------------------------------
// "Seen" recency sets — the per-user recency-exclusion behind a *fresh* set
// ---------------------------------------------------------------------------

/** MCQ question ids the user has been served in an attempt within the recency window. */
async function seenMcqIds(userId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - SEEN_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await selectAll<{ meta: { question_ids?: string[] } | null }>(() =>
    supabase()
      .from("attempts")
      .select("id, meta")
      .eq("user_id", userId)
      .gte("started_at", cutoff)
      .order("id", { ascending: true }),
  );
  const seen = new Set<string>();
  for (const r of rows) for (const id of r.meta?.question_ids ?? []) seen.add(id);
  return seen;
}

/** Descriptive question ids the user has already answered within the recency window. */
async function seenDescriptiveIds(userId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - SEEN_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await selectAll<{ question_id: string | null }>(() =>
    supabase()
      .from("answer_submissions")
      .select("id, question_id")
      .eq("user_id", userId)
      .not("question_id", "is", null)
      .gte("created_at", cutoff)
      .order("id", { ascending: true }),
  );
  return new Set(rows.map((r) => r.question_id).filter((x): x is string => !!x));
}

// ---------------------------------------------------------------------------
// Node resolution helpers
// ---------------------------------------------------------------------------

interface CustomNode {
  id: string;
  paper_code: string;
  title_i18n: BilingualText;
}

/** Validate every selected node exists and all share one paper (mirrors tests.ts's resolveOrderedNodes). */
async function resolveNodes(nodeIds: string[]): Promise<CustomNode[]> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, title_i18n")
    .in("id", nodeIds);
  if (error) throw new HttpError(500, `syllabus node lookup failed: ${error.message}`);
  const byId = new Map((data ?? []).map((n) => [n.id as string, n as unknown as CustomNode]));
  const missing = nodeIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw notFound(`Syllabus node not found: ${missing.join(", ")}`);
  const ordered = nodeIds.map((id) => byId.get(id)!);
  if (new Set(ordered.map((n) => n.paper_code)).size > 1) {
    throw badRequest("All selected topics must belong to the same paper");
  }
  return ordered;
}

/**
 * The depth-1 ancestor ids of the selected nodes. qgen/topup.ts attaches its
 * generated reserve to the DEPTH-1 node, so a leaf-scoped fresh set has to reach
 * up to its section's depth-1 node to actually see that reserve — otherwise the
 * demand→reserve→selection loop never closes (a leaf keeps hitting "preparing"
 * even after the reserve is generated). A selected node that IS depth-1 (or the
 * user's own leaf that carries generated questions) is included directly.
 */
async function depth1AncestorIds(nodeIds: string[]): Promise<string[]> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, path, depth")
    .in("id", nodeIds);
  if (error) throw new HttpError(500, `ancestor lookup failed: ${error.message}`);
  const out = new Set<string>();
  const segsByPaper = new Map<string, Set<string>>();
  for (const n of (data ?? []) as { id: string; paper_code: string; path: string | null; depth: number }[]) {
    if (n.depth === 1) {
      out.add(n.id);
      continue;
    }
    if (n.depth === 0) continue; // a paper root has no depth-1 ancestor
    const seg = (n.path ?? "").split("/")[0];
    if (!seg) continue;
    (segsByPaper.get(n.paper_code) ?? segsByPaper.set(n.paper_code, new Set()).get(n.paper_code)!).add(seg);
  }
  for (const [paper, segs] of segsByPaper) {
    const { data: tops, error: topErr } = await supabase()
      .from("syllabus_nodes")
      .select("id, path")
      .eq("paper_code", paper)
      .eq("depth", 1)
      .in("path", [...segs]);
    if (topErr) throw new HttpError(500, `ancestor resolve failed: ${topErr.message}`);
    for (const t of tops ?? []) out.add(t.id as string);
  }
  return [...out];
}

async function paperRootNodeId(paperCode: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id")
    .eq("paper_code", paperCode)
    .eq("depth", 0)
    .maybeSingle();
  if (error) throw new HttpError(500, `paper root lookup failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Pool building
// ---------------------------------------------------------------------------

interface PoolQuestion {
  id: string;
  marks: number | null;
}

interface QuestionRow {
  id: string;
  marks: number | null;
  source: string | null;
  syllabus_node_id: string | null;
}

function weightHotOf(weightage: Map<string, OwnWeightage>, year: number, nodeId: string | null): number {
  if (!nodeId) return 0;
  const w = weightage.get(nodeId);
  return w ? hotnessRaw(w.byYear, year) : 0;
}

/** CA MCQs whose source item is classified to any of the selected topics (step 6). */
async function currentAffairsOverlapPool(subtreeIds: string[], seen: Set<string>): Promise<PoolQuestion[]> {
  const { data: items, error } = await supabase()
    .from("current_affairs_items")
    .select("mcq_question_ids")
    .eq("is_published", true)
    .overlaps("syllabus_node_ids", subtreeIds);
  if (error) throw new HttpError(500, `current-affairs overlap lookup failed: ${error.message}`);
  const ids = [...new Set((items ?? []).flatMap((i) => (i.mcq_question_ids ?? []) as string[]))];
  if (ids.length === 0) return [];
  const rows = await fetchQuestionsByIds(ids, "test");
  return rows.filter((r) => !seen.has(r.id));
}

/** Fetch specific question ids under a visibility scope, chunked (a big `.in` list overflows the URL). */
async function fetchQuestionsByIds(ids: string[], scope: QuestionVisibilityScope): Promise<PoolQuestion[]> {
  const out: PoolQuestion[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, marks")
      .in("id", ids.slice(i, i + 100))
      .eq("type", "mcq")
      .or(questionVisibilityOrFilter(scope));
    if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
    out.push(...((data ?? []) as PoolQuestion[]));
  }
  return out;
}

/**
 * Combine unseen PYQ (precise subtree) → weightage-ranked generated reserve
 * (section-level ancestors) → CA overlap, deduped by id. PYQ-first so real past
 * questions always lead; the generated reserve and CA only fill beyond them —
 * which for a repeat user who's seen every PYQ is exactly where the reserve
 * earns its keep. Mirrors daily/quiz.ts's generatedPool/pyqPool pattern.
 */
function combinePool(
  pyq: QuestionRow[],
  generated: QuestionRow[],
  ca: PoolQuestion[],
  weightage: Map<string, OwnWeightage>,
  year: number,
): PoolQuestion[] {
  const rankedGenerated = shuffle(generated).sort(
    (a, b) => weightHotOf(weightage, year, b.syllabus_node_id) - weightHotOf(weightage, year, a.syllabus_node_id),
  );
  const seenIds = new Set<string>();
  const out: PoolQuestion[] = [];
  for (const r of [...shuffle(pyq), ...rankedGenerated, ...ca]) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    out.push({ id: r.id, marks: r.marks });
  }
  return out;
}

async function buildCustomMcqPool(opts: {
  subtreeIds: string[];
  generatedNodeIds: string[];
  exam?: ExamCode;
  difficulty?: Difficulty;
  seen: Set<string>;
}): Promise<PoolQuestion[]> {
  const subtreeSet = new Set(opts.subtreeIds);
  // PYQ (precise subtree) + generated reserve (its depth-1 section), "test"
  // scope — matches createCustomTestFromNode. Generated rows here are still
  // gated published+approved (the CA exception only admits CURRENT_AFFAIRS-coded
  // rows, and these carry a real PRE_/MAINS_ paper code), so the review gate
  // holds for the reserve.
  let q = supabase()
    .from("questions")
    .select("id, marks, source, syllabus_node_id")
    .in("syllabus_node_id", opts.generatedNodeIds)
    .eq("type", "mcq")
    .or(questionVisibilityOrFilter("test"));
  if (opts.exam) q = q.eq("exam_code", opts.exam);
  if (opts.difficulty) q = q.eq("difficulty", opts.difficulty);
  const { data, error } = await q;
  if (error) throw new HttpError(500, `fresh MCQ pool lookup failed: ${error.message}`);
  const rows = (data ?? []) as QuestionRow[];

  const pyq = rows.filter(
    (r) => r.source === "pyq" && r.syllabus_node_id && subtreeSet.has(r.syllabus_node_id) && !opts.seen.has(r.id),
  );
  const generated = rows.filter((r) => r.source === "generated" && !opts.seen.has(r.id));
  const ca = await currentAffairsOverlapPool(opts.subtreeIds, opts.seen);

  const weightage = await loadNodeWeightage();
  return combinePool(pyq, generated, ca, weightage, currentExamYear());
}

async function buildCustomDescriptivePool(opts: {
  subtreeIds: string[];
  generatedNodeIds: string[];
  seen: Set<string>;
}): Promise<PoolQuestion[]> {
  const subtreeSet = new Set(opts.subtreeIds);
  // Descriptive: catalog scope + UPPSC-only, matching createCustomAnswerTest
  // (this app also ingests non-UPPSC Mains-shaped content onto MAINS_* codes for
  // analytics — a user set must stay UPPSC-only). No CA (CA is prelims MCQ).
  const { data, error } = await supabase()
    .from("questions")
    .select("id, marks, source, syllabus_node_id")
    .in("syllabus_node_id", opts.generatedNodeIds)
    .eq("type", "descriptive")
    .eq("exam_code", UPPSC_EXAM_CODE)
    .or(questionVisibilityOrFilter("catalog"));
  if (error) throw new HttpError(500, `fresh descriptive pool lookup failed: ${error.message}`);
  const rows = (data ?? []) as QuestionRow[];

  const pyq = rows.filter(
    (r) => r.source === "pyq" && r.syllabus_node_id && subtreeSet.has(r.syllabus_node_id) && !opts.seen.has(r.id),
  );
  const generated = rows.filter((r) => r.source === "generated" && !opts.seen.has(r.id));

  const weightage = await loadNodeWeightage();
  return combinePool(pyq, generated, [], weightage, currentExamYear());
}

// ---------------------------------------------------------------------------
// Test row insertion (kind='on_demand' — never appears in any shared list)
// ---------------------------------------------------------------------------

async function insertOnDemandTest(p: {
  userId: string;
  paperCode: string;
  title: BilingualText;
  questions: PoolQuestion[];
  durationMinutes: number | null;
  meta: Record<string, unknown>;
}): Promise<TestDetail> {
  const totalMarks = roundMarks(p.questions.reduce((sum, q) => sum + (q.marks ?? 0), 0));
  const { data: test, error } = await supabase()
    .from("tests")
    .insert({
      title_i18n: p.title,
      kind: "on_demand",
      paper_code: p.paperCode,
      duration_minutes: p.durationMinutes,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { ...p.meta, on_demand: true, owner_user_id: p.userId },
    })
    .select("id")
    .single();
  if (error) throw new HttpError(500, `on-demand test insert failed: ${error.message}`);

  const { error: tqError } = await supabase()
    .from("test_questions")
    .insert(
      p.questions.map((q, index) => ({
        test_id: test.id as string,
        question_id: q.id,
        order_index: index,
        marks: q.marks,
      })),
    );
  if (tqError) {
    // No cross-table transaction in supabase-js — compensate by deleting the
    // just-created test so we never leave an orphaned 0-question row.
    await supabase().from("tests").delete().eq("id", test.id as string);
    throw new HttpError(500, `on-demand test questions insert failed: ${tqError.message}`);
  }
  return getTestDetail(test.id as string);
}

/** "New set: A" / "New set: A + 1 more". */
function freshCustomTitle(nodeTitles: BilingualText[]): BilingualText {
  const join = (titles: string[], moreWord: string): string =>
    titles.length <= 2 ? titles.join(" + ") : `${titles[0]} + ${titles.length - 1} ${moreWord}`;
  return {
    en: `New set: ${join(nodeTitles.map((t) => t.en), "more")}`,
    hi: `नया सेट: ${join(nodeTitles.map((t) => t.hi), "और")}`,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function createFreshCustomSet(
  userId: string,
  body: CreateFreshCustomSetBody,
): Promise<FreshSetResult> {
  const nodes = await resolveNodes(body.node_ids);

  // Log demand FIRST (deduped) — the signal drives tonight's reserve regardless
  // of whether this request could be filled now.
  await logDemand(userId, body.node_ids, "custom", body.exam ?? null);

  const subtreeSets = await Promise.all(body.node_ids.map(resolveSubtreeNodeIds));
  const subtreeIds = [...new Set(subtreeSets.flat())];
  const ancestorIds = await depth1AncestorIds(body.node_ids);
  const generatedNodeIds = [...new Set([...subtreeIds, ...ancestorIds])];

  const seen = body.kind === "mcq" ? await seenMcqIds(userId) : await seenDescriptiveIds(userId);
  const pool =
    body.kind === "mcq"
      ? await buildCustomMcqPool({ subtreeIds, generatedNodeIds, exam: body.exam, difficulty: body.difficulty, seen })
      : await buildCustomDescriptivePool({ subtreeIds, generatedNodeIds, seen });

  // Honest fallback ONLY when there is genuinely NOTHING fresh to serve (a niche
  // combination never requested before). Otherwise we build whatever unseen
  // questions exist — even fewer than requested — since the user asked for a
  // fresh set and "what's available now" is the honest answer (the builder's
  // hint says exactly that). Either way the request was logged above, so
  // tonight's top-up prepares more. Never a synchronous generation, never a
  // skipped review gate.
  if (pool.length === 0) {
    return { status: "preparing", requested_count: body.count, available_count: 0 };
  }

  const selected = pool.slice(0, body.count);
  const test = await insertOnDemandTest({
    userId,
    paperCode: nodes[0].paper_code,
    title: freshCustomTitle(nodes.map((n) => n.title_i18n)),
    questions: selected,
    durationMinutes: null,
    meta: { source: "on_demand", scope: "custom", kind: body.kind, source_syllabus_node_ids: body.node_ids },
  });
  return { status: "ready", test };
}

/**
 * A fresh full-length UPPSC-pattern mock for one paper. Unseen-first, then
 * backfilled with older-seen questions to always deliver a complete paper (a
 * mock must be full length to be a mock) — the demand signal it logs still
 * drives the reserve so each successive mock is fresher. Section-balanced via
 * the same weightedSample the seeded series uses.
 */
export async function createFreshMockSet(userId: string, body: CreateFreshMockSetBody): Promise<FreshSetResult> {
  const cfg = freshMockPaperConfig(body.paper_code);
  if (!cfg) throw badRequest("This paper has no mock structure");

  // Mocks are Pro-only. kind='on_demand' bypasses startAttempt's mock gate, so
  // gate at build time here instead (throws a 402 paywall for a Free user).
  await assertMockTests(userId);
  void touchFeature(userId, "mock");

  const rootId = await paperRootNodeId(body.paper_code);
  if (rootId) await logDemand(userId, [rootId], "mock", UPPSC_EXAM_CODE);

  const seen = cfg.kind === "mcq" ? await seenMcqIds(userId) : await seenDescriptiveIds(userId);
  const available = await availableMockPool(body.paper_code, cfg.kind);

  // Only unfillable if the paper genuinely lacks a full paper's worth of
  // questions (never true for a seeded mock paper) — honest fallback then.
  if (available.length < cfg.count) {
    return { status: "preparing", requested_count: cfg.count, available_count: available.length };
  }

  const weightage = await loadNodeWeightage();
  const hot = await sectionHotness(body.paper_code, weightage, currentExamYear());
  const weightOf = (top: string) => hot.get(top) ?? 0;

  // Unseen-first, section-balanced; backfill with seen to always reach count.
  const unseen = available.filter((q) => !seen.has(q.id));
  const seenPool = available.filter((q) => seen.has(q.id));
  let picked = weightedSample(unseen, cfg.count, weightOf);
  if (picked.length < cfg.count) {
    const used = new Set(picked.map((p) => p.id));
    picked = [
      ...picked,
      ...weightedSample(seenPool.filter((q) => !used.has(q.id)), cfg.count - picked.length, weightOf),
    ];
  }
  picked = picked.slice(0, cfg.count);

  // Re-weight to the real paper's marks (descriptive) or the flat MCQ scale.
  let questions: PoolQuestion[];
  if (cfg.marksPattern) {
    const pattern = shuffle(cfg.marksPattern);
    questions = picked.map((q, i) => ({ id: q.id, marks: pattern[i] ?? cfg.marksPattern![0] }));
  } else {
    questions = picked.map((q) => ({ id: q.id, marks: q.marks ?? DEFAULT_MCQ_MARKS }));
  }
  questions = shuffle(questions);

  const title: BilingualText = {
    en: `Fresh Mock — ${cfg.title.en}`,
    hi: `नया मॉक — ${cfg.title.hi}`,
  };
  const test = await insertOnDemandTest({
    userId,
    paperCode: body.paper_code,
    title,
    questions,
    durationMinutes: cfg.durationMinutes,
    meta: {
      source: "on_demand",
      scope: "mock",
      kind: cfg.kind,
      official_max_marks: cfg.officialMaxMarks,
      qualifying_pct: cfg.qualifyingPct,
      marking_scheme: cfg.marksPattern
        ? { type: "descriptive", negative_marking: 0 }
        : { type: "uppsc_prelims", negative_marking: cfg.negativeMarking, note: "one-third (1/3) negative marking" },
    },
  });
  return { status: "ready", test };
}
