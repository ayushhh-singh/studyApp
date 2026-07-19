import type { BilingualText, Question, QuestionsQuery } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";

export const QUESTIONS_PAGE_SIZE = 20;

// This app is India/UP-specific, so "today" follows IST (fixed UTC+5:30, no
// DST) rather than server UTC — same convention as the dashboard's greeting.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDayNumber(): number {
  return Math.floor((Date.now() + IST_OFFSET_MS) / (24 * 3600 * 1000));
}

const QUESTION_COLUMNS =
  "id, type, stage, exam_code, exam_label_i18n, source_kind, out_of_syllabus, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, correct_option_key, explanation_i18n, difficulty, word_limit, marks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listQuestions(
  filters: QuestionsQuery,
): Promise<{ items: Question[]; total: number }> {
  // `ids` is a standalone scoped fetch (a chapter section's own cited PYQs) —
  // it overrides every other filter/pagination rather than composing with
  // them, since the caller already knows exactly which rows it wants.
  if (filters.ids) {
    // Non-UUID entries are silently dropped rather than left to blow up the
    // query with a Postgres "invalid input syntax for type uuid" 500 — a
    // malformed id here is a client mistake, not something worth erroring on.
    const idList = [
      ...new Set(filters.ids.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s))),
    ].slice(0, 50);
    if (idList.length === 0) return { items: [], total: 0 };
    const { data, error } = await supabase()
      .from("questions")
      .select(QUESTION_COLUMNS)
      .in("id", idList)
      .or(questionVisibilityOrFilter("catalog"))
      .order("year", { ascending: false })
      .order("id", { ascending: true });
    if (error) throw new HttpError(500, `questions query failed: ${error.message}`);
    const items = (data ?? []) as unknown as Question[];
    return { items, total: items.length };
  }

  let query = supabase()
    .from("questions")
    .select(QUESTION_COLUMNS, { count: "exact" })
    .or(questionVisibilityOrFilter("catalog"));

  if (filters.paper) query = query.eq("paper_code", filters.paper);
  if (filters.node) {
    // Subtree-aware: a chapter (non-leaf) node has no questions of its own —
    // they hang off its leaf sub-topics — so match the whole subtree. For a
    // leaf this is just [node], i.e. the previous exact-match behaviour.
    const nodeIds = await resolveSubtreeNodeIds(filters.node);
    query = query.in("syllabus_node_id", nodeIds);
  }
  if (filters.year !== undefined) query = query.eq("year", filters.year);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.exam) query = query.eq("exam_code", filters.exam);

  const from = (filters.page - 1) * QUESTIONS_PAGE_SIZE;
  const to = from + QUESTIONS_PAGE_SIZE - 1;
  query = query.order("year", { ascending: false }).order("id", { ascending: true }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, `questions query failed: ${error.message}`);
  return { items: (data ?? []) as unknown as Question[], total: count ?? 0 };
}

/**
 * A daily-rotated descriptive question for the Answers hub's "today's
 * practice question" — a deterministic pick (IST day number mod the published
 * count) so every user sees the same question on a given day and it changes
 * once every 24h, without needing a dedicated schedule/table.
 */
export async function getTodaysQuestion(): Promise<Question | null> {
  const { count, error: countError } = await supabase()
    .from("questions")
    .select("id", { count: "exact", head: true })
    .or(questionVisibilityOrFilter("catalog"))
    .eq("type", "descriptive");
  if (countError) throw new HttpError(500, `descriptive question count failed: ${countError.message}`);
  if (!count) return null;

  const index = istDayNumber() % count;
  const { data, error } = await supabase()
    .from("questions")
    .select(QUESTION_COLUMNS)
    .or(questionVisibilityOrFilter("catalog"))
    .eq("type", "descriptive")
    .order("id", { ascending: true })
    .range(index, index)
    .maybeSingle();
  if (error) throw new HttpError(500, `today's question query failed: ${error.message}`);
  return (data as unknown as Question) ?? null;
}

export async function getQuestionById(id: string): Promise<Question> {
  const { data, error } = await supabase()
    .from("questions")
    .select(QUESTION_COLUMNS)
    .eq("id", id)
    .or(questionVisibilityOrFilter("catalog"))
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as unknown as Question;
}

export interface QuestionForExplain {
  id: string;
  syllabus_node_id: string | null;
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

export async function getQuestionForExplain(questionId: string): Promise<QuestionForExplain> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, syllabus_node_id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .eq("id", questionId)
    .or(questionVisibilityOrFilter("catalog"))
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as unknown as QuestionForExplain;
}

/**
 * Persists an AI-generated explanation once. The `is("explanation_i18n", null)`
 * filter enforces "never overwrite existing content" at the write layer rather
 * than trusting the caller's read-then-write check — it also makes two
 * concurrent generations for the same question converge on one winner instead
 * of the second clobbering the first.
 */
export async function persistQuestionExplanation(
  questionId: string,
  explanationI18n: BilingualText,
): Promise<void> {
  const { error } = await supabase()
    .from("questions")
    .update({ explanation_i18n: explanationI18n })
    .eq("id", questionId)
    .is("explanation_i18n", null);
  if (error) throw new HttpError(500, `explanation persist failed: ${error.message}`);
}
