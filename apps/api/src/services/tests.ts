import type {
  BilingualText,
  CreateCustomTestBody,
  MarkingScheme,
  TestDetail,
  TestKind,
  TestQuestionPublic,
  TestSummary,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { currentUserId } from "../lib/user-context.js";
import { CURRENT_AFFAIRS_PAPER_CODE, questionVisibilityOrFilter, UPPSC_EXAM_CODE } from "../lib/question-visibility.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";

export { CURRENT_AFFAIRS_PAPER_CODE };

interface TestListFilters {
  kind?: TestKind;
  paper?: string;
  stage?: "prelims" | "mains";
}

interface TestListRow {
  id: string;
  slug: string | null;
  title_i18n: TestSummary["title_i18n"];
  kind: TestKind;
  paper_code: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  meta: { year?: number } | null;
  test_questions: { count: number }[];
}

export async function listTests(filters: TestListFilters): Promise<TestSummary[]> {
  let query = supabase()
    .from("tests")
    .select("id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, meta, test_questions(count)")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.paper) query = query.eq("paper_code", filters.paper);
  // pyq_full/sectional/mock/custom are all shared between the MCQ Practice
  // tab and the descriptive Answers "Practice Tests" tab — every kind
  // defaults to Prelims-only unless the caller explicitly asks for Mains.
  // This used to only guard pyq_full/sectional (mock/custom had no fallback
  // at all, since Mains mocks/custom sets didn't exist yet when that default
  // was written) — Mains mock tests then leaked straight into the MCQ
  // Practice page's Mock Tests tab the moment they were built, because nothing
  // stopped a caller that forgot to pass `stage`. Defaulting every kind the
  // same way closes that off for good instead of relying on every call site
  // remembering to opt in. Prelims paper codes are always prefixed "PRE_"
  // (see ingest/_shared.ts's PAPERS); Mains is everything else except the
  // current-affairs quiz's own synthetic paper code.
  if (filters.stage === "mains") {
    query = query.not("paper_code", "like", "PRE_%").neq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
  } else {
    query = query.like("paper_code", "PRE_%");
  }
  // "Quiz me on this week" (createCustomTestFromCurrentAffairs) also stamps
  // kind="custom" — exclude it from the Custom tab's "your custom sets" list
  // (both Prelims and Mains) so a user's own topic-built sets aren't buried
  // under repeat CA-quiz clicks; the Current Affairs page is that quiz's own
  // dedicated entry point. Always applied (not just when stage isn't
  // "mains") — the mains-stage paper_code filter already excludes it too,
  // but this is a defense-in-depth no-op, not a load-bearing branch.
  if (filters.kind === "custom") {
    query = query.neq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
  }

  const { data, error } = await query;
  if (error) throw new HttpError(500, `tests query failed: ${error.message}`);

  const rows = (data ?? []) as unknown as TestListRow[];
  const bestScores = await getBestScoresByTest(rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title_i18n: row.title_i18n,
    kind: row.kind,
    paper_code: row.paper_code,
    duration_minutes: row.duration_minutes,
    total_marks: row.total_marks,
    question_count: row.test_questions[0]?.count ?? 0,
    best_score: bestScores.get(row.id)?.best ?? null,
    attempts_count: bestScores.get(row.id)?.count ?? 0,
    year: row.meta?.year ?? null,
  }));
}

/** Best (max) submitted score + attempt count per test, for the dev user. */
export async function getBestScoresByTest(testIds: string[]): Promise<Map<string, { best: number; count: number }>> {
  const out = new Map<string, { best: number; count: number }>();
  if (testIds.length === 0) return out;

  const { data, error } = await supabase()
    .from("attempts")
    .select("test_id, score")
    .eq("user_id", currentUserId())
    .not("test_id", "is", null)
    .not("submitted_at", "is", null)
    .in("test_id", testIds);
  if (error) throw new HttpError(500, `attempts lookup failed: ${error.message}`);

  for (const row of (data ?? []) as { test_id: string; score: number | null }[]) {
    const score = row.score ?? 0;
    const existing = out.get(row.test_id);
    if (!existing) {
      out.set(row.test_id, { best: score, count: 1 });
    } else {
      existing.best = Math.max(existing.best, score);
      existing.count += 1;
    }
  }
  return out;
}

interface TestQuestionJoinRow {
  order_index: number;
  marks: number | null;
  questions: {
    id: string;
    type: TestQuestionPublic["type"];
    stage: TestQuestionPublic["stage"];
    exam_code: TestQuestionPublic["exam_code"];
    exam_label_i18n: TestQuestionPublic["exam_label_i18n"];
    source_kind: TestQuestionPublic["source_kind"];
    out_of_syllabus: boolean;
    paper_code: string;
    syllabus_node_id: string | null;
    year: number | null;
    source: TestQuestionPublic["source"];
    stem_i18n: TestQuestionPublic["stem_i18n"];
    options_i18n: TestQuestionPublic["options_i18n"];
    difficulty: TestQuestionPublic["difficulty"];
    word_limit: number | null;
    marks: number | null;
  };
}

export async function getTestDetail(testId: string): Promise<TestDetail> {
  const { data: test, error } = await supabase()
    .from("tests")
    .select("id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, meta")
    .eq("id", testId)
    .eq("is_published", true)
    .maybeSingle();
  if (error) throw new HttpError(500, `test lookup failed: ${error.message}`);
  if (!test) throw notFound("Test not found");

  // !inner + the question-visibility filter excludes questions retracted
  // after the test was assembled — must match the same filter in
  // startAttempt/submitAttempt, or the player would show (and let a user
  // answer) a question that can never be scored. The "test" scope's
  // current-affairs exception keeps that one quiz's always-unpublished
  // AI-generated MCQs visible without letting them leak anywhere else (see
  // lib/question-visibility.ts).
  const { data: tq, error: tqError } = await supabase()
    .from("test_questions")
    .select(
      "order_index, marks, questions!inner(id, type, stage, exam_code, exam_label_i18n, source_kind, out_of_syllabus, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, difficulty, word_limit, marks, is_published)",
    )
    .eq("test_id", testId)
    .or(questionVisibilityOrFilter("test"), { referencedTable: "questions" })
    .order("order_index", { ascending: true });
  if (tqError) throw new HttpError(500, `test questions lookup failed: ${tqError.message}`);

  const rows = (tq ?? []) as unknown as TestQuestionJoinRow[];
  const questions: TestQuestionPublic[] = rows.map((row) => ({
    id: row.questions.id,
    type: row.questions.type,
    stage: row.questions.stage,
    exam_code: row.questions.exam_code,
    exam_label_i18n: row.questions.exam_label_i18n,
    source_kind: row.questions.source_kind,
    out_of_syllabus: row.questions.out_of_syllabus,
    paper_code: row.questions.paper_code,
    syllabus_node_id: row.questions.syllabus_node_id,
    year: row.questions.year,
    source: row.questions.source,
    stem_i18n: row.questions.stem_i18n,
    options_i18n: row.questions.options_i18n,
    difficulty: row.questions.difficulty,
    word_limit: row.questions.word_limit,
    order_index: row.order_index,
    marks: row.marks ?? row.questions.marks,
  }));

  const meta = test.meta as { marking_scheme?: MarkingScheme; year?: number } | null;
  const markingScheme = (meta?.marking_scheme ?? null) as MarkingScheme;
  const bestScore = (await getBestScoresByTest([testId])).get(testId);

  return {
    id: test.id,
    slug: test.slug,
    title_i18n: test.title_i18n,
    kind: test.kind,
    paper_code: test.paper_code,
    duration_minutes: test.duration_minutes,
    total_marks: test.total_marks,
    question_count: questions.length,
    best_score: bestScore?.best ?? null,
    attempts_count: bestScore?.count ?? 0,
    year: meta?.year ?? null,
    marking_scheme: markingScheme,
    questions,
  };
}

/** "Practice: A" for one topic, "Practice: A + B" for two, "Practice: A + 2 more"/"+ 2 और" beyond that. */
function customTestTitle(nodeTitles: BilingualText[]): BilingualText {
  function join(titles: string[], moreWord: string): string {
    if (titles.length <= 2) return titles.join(" + ");
    return `${titles[0]} + ${titles.length - 1} ${moreWord}`;
  }
  return {
    en: `Practice: ${join(
      nodeTitles.map((t) => t.en),
      "more",
    )}`,
    hi: `अभ्यास: ${join(
      nodeTitles.map((t) => t.hi),
      "और",
    )}`,
  };
}

/** Fisher-Yates shuffle so repeated "Practice this topic" clicks don't always surface the same subset. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface CustomTestNode {
  id: string;
  paper_code: string;
  title_i18n: unknown;
}

/**
 * Looks up every requested topic, in the caller's selection order, and
 * enforces two invariants the single-node_id version got for free: every id
 * must resolve to a real node (a stale/typo'd id used to just be silently
 * dropped, building a test scoped to fewer topics than the user actually
 * asked for with no error), and every selected topic must belong to the same
 * paper (the resulting test is stamped with one paper_code from the first
 * node — mixing papers would silently mislabel a test's questions).
 */
async function resolveOrderedNodes(nodeIds: string[]): Promise<CustomTestNode[]> {
  const { data: nodes, error: nodesError } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, title_i18n")
    .in("id", nodeIds);
  if (nodesError) throw new HttpError(500, `syllabus node lookup failed: ${nodesError.message}`);
  const nodeById = new Map((nodes ?? []).map((n) => [n.id as string, n as CustomTestNode]));
  const missing = nodeIds.filter((id) => !nodeById.has(id));
  if (missing.length > 0) throw notFound(`Syllabus node not found: ${missing.join(", ")}`);
  const orderedNodes = nodeIds.map((id) => nodeById.get(id)!);
  const paperCodes = new Set(orderedNodes.map((n) => n.paper_code));
  if (paperCodes.size > 1) {
    throw badRequest("All selected topics must belong to the same paper");
  }
  return orderedNodes;
}

export async function createCustomTestFromNode(body: CreateCustomTestBody): Promise<TestDetail> {
  const orderedNodes = await resolveOrderedNodes(body.node_ids);

  // type=mcq: this builds an MCQ test-player set — a syllabus node can carry
  // descriptive PYQs too (Mains topics), which the player can't run. "catalog"
  // scope (not "test"): a syllabus node's own topic-practice set must never
  // pull in the current-affairs pool's always-unpublished MCQs, even though
  // ca:run does map them to a syllabus_node_id.
  // Subtree-aware so "Practice this topic" works on a chapter (non-leaf) node,
  // whose MCQ PYQs live on its leaf sub-topics; a leaf resolves to just [node].
  // Multiple topics union their subtrees and dedupe by question id (two
  // selected topics could share a sub-topic's questions otherwise).
  const subtreeIdSets = await Promise.all(body.node_ids.map((id) => resolveSubtreeNodeIds(id)));
  const subtreeIds = [...new Set(subtreeIdSets.flat())];
  let questionsQuery = supabase()
    .from("questions")
    .select("id, marks")
    .in("syllabus_node_id", subtreeIds)
    .eq("type", "mcq")
    .or(questionVisibilityOrFilter("catalog"));
  if (body.difficulty) questionsQuery = questionsQuery.eq("difficulty", body.difficulty);
  // Omitting `exam` mixes every exam mapped to the topic (the default); passing
  // one narrows the set to a single exam's PYQs.
  if (body.exam) questionsQuery = questionsQuery.eq("exam_code", body.exam);
  const { data: questionRows, error: questionsError } = await questionsQuery;
  if (questionsError) throw new HttpError(500, `node question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0)
    throw badRequest("No published MCQ PYQs are mapped to these topics (and difficulty) yet");

  const selected = shuffled(available).slice(0, body.count);
  const totalMarks = selected.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      title_i18n: customTestTitle(orderedNodes.map((n) => n.title_i18n as BilingualText)),
      kind: "custom",
      paper_code: orderedNodes[0].paper_code,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source_syllabus_node_ids: body.node_ids },
    })
    .select("id")
    .single();
  if (testError) throw new HttpError(500, `custom test insert failed: ${testError.message}`);

  const { error: tqError } = await supabase()
    .from("test_questions")
    .insert(
      selected.map((q, index) => ({
        test_id: test.id as string,
        question_id: q.id,
        order_index: index,
        marks: q.marks,
      })),
    );
  if (tqError) {
    // supabase-js has no cross-table transaction — compensate by deleting the
    // just-created test rather than leaving an orphaned, published, 0-question
    // test permanently visible in the shared /practice list.
    await supabase().from("tests").delete().eq("id", test.id as string);
    throw new HttpError(500, `custom test questions insert failed: ${tqError.message}`);
  }

  return getTestDetail(test.id as string);
}

/**
 * Descriptive sibling of createCustomTestFromNode — same multi-topic
 * union-of-subtrees approach, but type="descriptive" and no difficulty
 * filter (descriptive questions don't carry one). Feeds an answer test
 * session exactly like a pyq_full/sectional/mock test does — this just
 * builds the tests/test_questions row; nothing here is MCQ-specific.
 */
export async function createCustomAnswerTest(nodeIds: string[], count: number): Promise<TestDetail> {
  const orderedNodes = await resolveOrderedNodes(nodeIds);

  const subtreeIdSets = await Promise.all(nodeIds.map((id) => resolveSubtreeNodeIds(id)));
  const subtreeIds = [...new Set(subtreeIdSets.flat())];
  const { data: questionRows, error: questionsError } = await supabase()
    .from("questions")
    .select("id, marks")
    .in("syllabus_node_id", subtreeIds)
    .eq("type", "descriptive")
    // Same rationale as ingest/tests.ts's pyq_full/sectional builders and
    // services/mocks.ts's mock builders: this app also ingests non-UPPSC
    // Mains-shaped content (e.g. UPSC Civil Services) onto the same MAINS_*
    // paper codes for weightage analytics (classifyPyqId in
    // ingest/_shared.ts). A user-built custom set must stay UPPSC-only, or
    // it silently reintroduces the exact mixed-exam contamination this
    // session's earlier fix addressed for every other test-assembly path.
    .eq("exam_code", UPPSC_EXAM_CODE)
    .or(questionVisibilityOrFilter("catalog"));
  if (questionsError) throw new HttpError(500, `node question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0) throw badRequest("No published descriptive PYQs are mapped to these topics yet");

  const selected = shuffled(available).slice(0, count);
  const totalMarks = selected.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      title_i18n: customTestTitle(orderedNodes.map((n) => n.title_i18n as BilingualText)),
      kind: "custom",
      paper_code: orderedNodes[0].paper_code,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source_syllabus_node_ids: nodeIds },
    })
    .select("id")
    .single();
  if (testError) throw new HttpError(500, `custom answer test insert failed: ${testError.message}`);

  const { error: tqError } = await supabase()
    .from("test_questions")
    .insert(
      selected.map((q, index) => ({
        test_id: test.id as string,
        question_id: q.id,
        order_index: index,
        marks: q.marks,
      })),
    );
  if (tqError) {
    await supabase().from("tests").delete().eq("id", test.id as string);
    throw new HttpError(500, `custom answer test questions insert failed: ${tqError.message}`);
  }

  return getTestDetail(test.id as string);
}

function currentAffairsQuizTitle(days: number): BilingualText {
  return { en: `Current Affairs — Last ${days} Days`, hi: `करेंट अफेयर्स — पिछले ${days} दिन` };
}

// One sitting shouldn't be every CA MCQ generated over the window (that grows
// unbounded as the ca:run pipeline keeps producing more) — cap it like the
// daily quiz's own defaultSize (daily/config.ts). A repeat "Quiz me" click
// mostly draws fresh (never-attempted-by-this-user) questions, with a small
// reinforcement slice of ones the user has seen before, so it neither repeats
// the exact same set nor is 100% novel every time.
const CURRENT_AFFAIRS_QUIZ_SIZE = 25;
const CURRENT_AFFAIRS_REINFORCEMENT_RATIO = 0.2;

/** Question ids this user has already been given in a past "Quiz me on this week" attempt. */
async function seenCurrentAffairsQuestionIds(userId: string): Promise<Set<string>> {
  const { data: caTests, error: caTestsError } = await supabase()
    .from("tests")
    .select("id")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
  if (caTestsError) throw new HttpError(500, `past CA quiz lookup failed: ${caTestsError.message}`);
  const caTestIds = (caTests ?? []).map((t) => t.id as string);
  if (caTestIds.length === 0) return new Set();

  const { data: pastAttempts, error: attemptsError } = await supabase()
    .from("attempts")
    .select("meta")
    .eq("user_id", userId)
    .in("test_id", caTestIds);
  if (attemptsError) throw new HttpError(500, `past CA attempt lookup failed: ${attemptsError.message}`);

  const seen = new Set<string>();
  for (const row of pastAttempts ?? []) {
    const questionIds = (row.meta as { question_ids?: string[] } | null)?.question_ids ?? [];
    for (const id of questionIds) seen.add(id);
  }
  return seen;
}

/**
 * "Quiz me on this week" — a custom test built from generated MCQs linked off
 * current_affairs_items rows dated within the last `days` days
 * (mcq_question_ids, populated by the ca:run pipeline for "important"
 * items), capped to CURRENT_AFFAIRS_QUIZ_SIZE and mixed with a reinforcement
 * slice of previously-seen questions. Mirrors createCustomTestFromNode's
 * shape/behaviour (shuffle, compensating delete on a partial insert failure)
 * but pools questions across many source items instead of one syllabus node.
 *
 * Uses "test" scope (lib/question-visibility.ts): CA-generated MCQs are
 * always inserted with is_published=false (see ca/pipeline.ts's
 * insertMcqsForItem) so they never leak into the general PYQ catalog/search,
 * NOT because they're pending some review step that would later flip it (no
 * such reviewer role/UI exists in this pre-auth app) — this quiz IS their
 * intended distribution surface, gated instead by the classify step's
 * "important" bar and the fact-constrained generation prompt. The scoped
 * filter is a defense-in-depth no-op here (every id already comes from a
 * current-affairs item's own mcq_question_ids) rather than a behaviour
 * change.
 */
export async function createCustomTestFromCurrentAffairs(days: number): Promise<TestDetail> {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: items, error: itemsError } = await supabase()
    .from("current_affairs_items")
    .select("mcq_question_ids")
    .eq("is_published", true)
    .gte("date", cutoff);
  if (itemsError) throw new HttpError(500, `current affairs lookup failed: ${itemsError.message}`);

  const questionIds = [...new Set((items ?? []).flatMap((i) => (i.mcq_question_ids ?? []) as string[]))];
  if (questionIds.length === 0) {
    throw badRequest(`No current-affairs practice MCQs are available for the last ${days} days yet`);
  }

  const { data: questionRows, error: questionsError } = await supabase()
    .from("questions")
    .select("id, marks")
    .in("id", questionIds)
    .or(questionVisibilityOrFilter("test"));
  if (questionsError) throw new HttpError(500, `question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0) {
    throw badRequest(`No current-affairs practice MCQs are available for the last ${days} days yet`);
  }

  const seenIds = await seenCurrentAffairsQuestionIds(currentUserId());
  const freshPool = available.filter((q) => !seenIds.has(q.id));
  const seenPool = available.filter((q) => seenIds.has(q.id));

  const targetSize = Math.min(CURRENT_AFFAIRS_QUIZ_SIZE, available.length);
  const targetReinforcement =
    seenPool.length > 0 ? Math.min(seenPool.length, Math.round(targetSize * CURRENT_AFFAIRS_REINFORCEMENT_RATIO)) : 0;
  const targetFresh = targetSize - targetReinforcement;

  let selected = [...shuffled(freshPool).slice(0, targetFresh), ...shuffled(seenPool).slice(0, targetReinforcement)];
  if (selected.length < targetSize) {
    // Either pool came up short (e.g. a brand-new user has no seenPool yet,
    // or most of the window's questions have already been reinforced) —
    // top off from whatever's left rather than shipping a thin quiz.
    const usedIds = new Set(selected.map((q) => q.id));
    const leftover = shuffled(available.filter((q) => !usedIds.has(q.id)));
    selected = [...selected, ...leftover.slice(0, targetSize - selected.length)];
  }
  selected = shuffled(selected);
  const totalMarks = selected.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      title_i18n: currentAffairsQuizTitle(days),
      kind: "custom",
      paper_code: CURRENT_AFFAIRS_PAPER_CODE,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source: "current_affairs", days },
    })
    .select("id")
    .single();
  if (testError) throw new HttpError(500, `current affairs quiz insert failed: ${testError.message}`);

  const { error: tqError } = await supabase()
    .from("test_questions")
    .insert(
      selected.map((q, index) => ({
        test_id: test.id as string,
        question_id: q.id,
        order_index: index,
        marks: q.marks,
      })),
    );
  if (tqError) {
    await supabase().from("tests").delete().eq("id", test.id as string);
    throw new HttpError(500, `current affairs quiz questions insert failed: ${tqError.message}`);
  }

  return getTestDetail(test.id as string);
}
