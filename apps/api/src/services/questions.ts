import type { BilingualText, Question, QuestionsQuery } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";

export const QUESTIONS_PAGE_SIZE = 20;

// This app is India/UP-specific, so "today" follows IST (fixed UTC+5:30, no
// DST) rather than server UTC — same convention as the dashboard's greeting.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDayNumber(): number {
  return Math.floor((Date.now() + IST_OFFSET_MS) / (24 * 3600 * 1000));
}

const QUESTION_COLUMNS =
  "id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, correct_option_key, explanation_i18n, difficulty, word_limit, marks";

export async function listQuestions(
  filters: QuestionsQuery,
): Promise<{ items: Question[]; total: number }> {
  let query = supabase()
    .from("questions")
    .select(QUESTION_COLUMNS, { count: "exact" })
    .or(questionVisibilityOrFilter("catalog"));

  if (filters.paper) query = query.eq("paper_code", filters.paper);
  if (filters.node) query = query.eq("syllabus_node_id", filters.node);
  if (filters.year !== undefined) query = query.eq("year", filters.year);
  if (filters.type) query = query.eq("type", filters.type);

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
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

export async function getQuestionForExplain(questionId: string): Promise<QuestionForExplain> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
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
