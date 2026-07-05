import type { MarkingScheme, TestDetail, TestKind, TestQuestionPublic, TestSummary } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

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

  return ((data ?? []) as unknown as TestListRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    title_i18n: row.title_i18n,
    kind: row.kind,
    paper_code: row.paper_code,
    duration_minutes: row.duration_minutes,
    total_marks: row.total_marks,
    question_count: row.test_questions[0]?.count ?? 0,
  }));
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

  const { data: tq, error: tqError } = await supabase()
    .from("test_questions")
    .select(
      "order_index, marks, questions(id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, difficulty, word_limit, marks)",
    )
    .eq("test_id", testId)
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

  return {
    id: test.id,
    slug: test.slug,
    title_i18n: test.title_i18n,
    kind: test.kind,
    paper_code: test.paper_code,
    duration_minutes: test.duration_minutes,
    total_marks: test.total_marks,
    question_count: questions.length,
    marking_scheme: markingScheme,
    questions,
  };
}
