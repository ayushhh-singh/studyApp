import type {
  BilingualText,
  CreateCustomTestBody,
  MarkingScheme,
  TestDetail,
  TestKind,
  TestQuestionPublic,
  TestSummary,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { devUserId } from "../lib/dev-user.js";

/**
 * The synthetic paper_code for ca:run-generated MCQs and their "Quiz me on
 * this week" test. Those questions are always is_published=false (never
 * meant to leak into the general PYQ catalog/search — see
 * createCustomTestFromCurrentAffairs below) so every place that fetches a
 * test's questions (here and in services/attempts.ts) must treat THIS one
 * paper_code as the exception to the normal "is_published=true" gate.
 */
export const CURRENT_AFFAIRS_PAPER_CODE = "CURRENT_AFFAIRS";

interface TestListFilters {
  kind?: TestKind;
  paper?: string;
}

interface TestListRow {
  id: string;
  slug: string | null;
  title_i18n: TestSummary["title_i18n"];
  kind: TestKind;
  paper_code: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  test_questions: { count: number }[];
}

export async function listTests(filters: TestListFilters): Promise<TestSummary[]> {
  let query = supabase()
    .from("tests")
    .select("id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, test_questions(count)")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.paper) query = query.eq("paper_code", filters.paper);
  // pyq_full/sectional are MCQ test-taking surfaces (the Practice tab's
  // test-player only knows how to run MCQ attempts) — but ingest:tests builds
  // them for EVERY paper with published PYQs, including the 8 Mains papers,
  // which are 100% descriptive and belong to the separate Answers feature.
  // Prelims paper codes are always prefixed "PRE_" (see ingest/_shared.ts's
  // PAPERS); excluding anything else keeps a Mains "full paper"/"sectional"
  // test out of a UI that can't render it.
  if (filters.kind === "pyq_full" || filters.kind === "sectional") {
    query = query.like("paper_code", "PRE_%");
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
  }));
}

/** Best (max) submitted score + attempt count per test, for the dev user. */
export async function getBestScoresByTest(testIds: string[]): Promise<Map<string, { best: number; count: number }>> {
  const out = new Map<string, { best: number; count: number }>();
  if (testIds.length === 0) return out;

  const { data, error } = await supabase()
    .from("attempts")
    .select("test_id, score")
    .eq("user_id", devUserId())
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

  // !inner + questions.is_published filters out questions retracted after the
  // test was assembled — must match the same filter in startAttempt/
  // submitAttempt, or the player would show (and let a user answer) a
  // question that can never be scored. EXCEPT current-affairs quizzes: their
  // questions are deliberately always is_published=false (the ca:run
  // pipeline's review gate keeps AI-generated MCQs out of the general PYQ
  // catalog/search) — for this one paper_code, "unpublished" doesn't mean
  // "retracted", so the filter would make every such quiz permanently empty.
  let tqQuery = supabase()
    .from("test_questions")
    .select(
      "order_index, marks, questions!inner(id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, difficulty, word_limit, marks, is_published)",
    )
    .eq("test_id", testId);
  if (test.paper_code !== CURRENT_AFFAIRS_PAPER_CODE) {
    tqQuery = tqQuery.eq("questions.is_published", true);
  }
  const { data: tq, error: tqError } = await tqQuery.order("order_index", { ascending: true });
  if (tqError) throw new HttpError(500, `test questions lookup failed: ${tqError.message}`);

  const rows = (tq ?? []) as unknown as TestQuestionJoinRow[];
  const questions: TestQuestionPublic[] = rows.map((row) => ({
    id: row.questions.id,
    type: row.questions.type,
    stage: row.questions.stage,
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

  const markingScheme = ((test.meta as { marking_scheme?: MarkingScheme } | null)?.marking_scheme ??
    null) as MarkingScheme;
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
    marking_scheme: markingScheme,
    questions,
  };
}

function customTestTitle(nodeTitle: BilingualText): BilingualText {
  return { en: `Practice: ${nodeTitle.en}`, hi: `अभ्यास: ${nodeTitle.hi}` };
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

export async function createCustomTestFromNode(body: CreateCustomTestBody): Promise<TestDetail> {
  const { data: node, error: nodeError } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, title_i18n")
    .eq("id", body.node_id)
    .maybeSingle();
  if (nodeError) throw new HttpError(500, `syllabus node lookup failed: ${nodeError.message}`);
  if (!node) throw notFound("Syllabus node not found");

  // type=mcq: this builds an MCQ test-player set — a syllabus node can carry
  // descriptive PYQs too (Mains topics), which the player can't run.
  let questionsQuery = supabase()
    .from("questions")
    .select("id, marks")
    .eq("syllabus_node_id", body.node_id)
    .eq("type", "mcq")
    .eq("is_published", true);
  if (body.difficulty) questionsQuery = questionsQuery.eq("difficulty", body.difficulty);
  const { data: questionRows, error: questionsError } = await questionsQuery;
  if (questionsError) throw new HttpError(500, `node question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0) throw badRequest("No published MCQ PYQs are mapped to this topic (and difficulty) yet");

  const selected = shuffled(available).slice(0, body.count);
  const totalMarks = selected.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .insert({
      title_i18n: customTestTitle(node.title_i18n as BilingualText),
      kind: "custom",
      paper_code: node.paper_code,
      total_marks: totalMarks || null,
      is_published: true,
      meta: { source_syllabus_node_id: body.node_id },
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

function currentAffairsQuizTitle(days: number): BilingualText {
  return { en: `Current Affairs — Last ${days} Days`, hi: `करेंट अफेयर्स — पिछले ${days} दिन` };
}

/**
 * "Quiz me on this week" — a custom test built from every generated MCQ
 * linked off a current_affairs_items row dated within the last `days` days
 * (mcq_question_ids, populated by the ca:run pipeline for "important"
 * items). Mirrors createCustomTestFromNode's shape/behaviour (shuffle,
 * compensating delete on a partial insert failure) but pools questions
 * across many source items instead of one syllabus node.
 *
 * Deliberately does NOT filter questions.is_published — CA-generated MCQs
 * are always inserted with is_published=false (see ca/pipeline.ts's
 * insertMcqsForItem) so they never leak into the general PYQ catalog/search,
 * NOT because they're pending some review step that would later flip it (no
 * such reviewer role/UI exists in this pre-auth app). This quiz IS their
 * intended distribution surface — gated instead by the classify step's
 * "important" bar and the fact-constrained generation prompt.
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
    .in("id", questionIds);
  if (questionsError) throw new HttpError(500, `question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0) {
    throw badRequest(`No current-affairs practice MCQs are available for the last ${days} days yet`);
  }

  const selected = shuffled(available);
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
