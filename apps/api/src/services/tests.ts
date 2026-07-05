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
  // question that can never be scored.
  const { data: tq, error: tqError } = await supabase()
    .from("test_questions")
    .select(
      "order_index, marks, questions!inner(id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, difficulty, word_limit, marks, is_published)",
    )
    .eq("test_id", testId)
    .eq("questions.is_published", true)
    .order("order_index", { ascending: true });
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

  let questionsQuery = supabase()
    .from("questions")
    .select("id, marks")
    .eq("syllabus_node_id", body.node_id)
    .eq("is_published", true);
  if (body.difficulty) questionsQuery = questionsQuery.eq("difficulty", body.difficulty);
  const { data: questionRows, error: questionsError } = await questionsQuery;
  if (questionsError) throw new HttpError(500, `node question lookup failed: ${questionsError.message}`);
  const available = (questionRows ?? []) as { id: string; marks: number | null }[];
  if (available.length === 0) throw badRequest("No published PYQs are mapped to this topic (and difficulty) yet");

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
