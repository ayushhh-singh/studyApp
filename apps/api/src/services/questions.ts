import type { BilingualText, Question, QuestionsQuery } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

export const QUESTIONS_PAGE_SIZE = 20;

const QUESTION_COLUMNS =
  "id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, correct_option_key, explanation_i18n, difficulty, word_limit, marks";

export async function listQuestions(
  filters: QuestionsQuery,
): Promise<{ items: Question[]; total: number }> {
  let query = supabase()
    .from("questions")
    .select(QUESTION_COLUMNS, { count: "exact" })
    .eq("is_published", true);

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
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as unknown as QuestionForExplain;
}

/** Persists an AI-generated explanation once — an ingested explanation is never overwritten by this path. */
export async function persistQuestionExplanation(
  questionId: string,
  explanationI18n: BilingualText,
): Promise<void> {
  const { error } = await supabase()
    .from("questions")
    .update({ explanation_i18n: explanationI18n })
    .eq("id", questionId);
  if (error) throw new HttpError(500, `explanation persist failed: ${error.message}`);
}
