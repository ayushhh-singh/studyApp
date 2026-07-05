import type { BilingualText, SrsCard } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

interface SrsCardRow {
  id: string;
  user_id: string;
  front_i18n: BilingualText;
  back_i18n: BilingualText;
  source_type: SrsCard["source_type"];
  source_id: string | null;
}

const SRS_CARD_COLUMNS = "id, user_id, front_i18n, back_i18n, source_type, source_id";

/**
 * Add a syllabus topic to revision. Idempotent via a DB-level unique index on
 * (user_id, source_type, source_id) (migration 0026) + upsert — a plain
 * check-then-insert can't actually guarantee this under concurrent requests
 * (two near-simultaneous clicks could both pass the lookup before either
 * insert lands), so the uniqueness has to be enforced by the database, not
 * just by application logic.
 */
export async function addNodeToRevision(userId: string, nodeId: string): Promise<SrsCard> {
  const { data: node, error: nodeError } = await supabase()
    .from("syllabus_nodes")
    .select("title_i18n, description_i18n")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeError) throw new HttpError(500, `syllabus node lookup failed: ${nodeError.message}`);
  if (!node) throw notFound("Syllabus node not found");

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: node.title_i18n,
        back_i18n: node.description_i18n ?? { hi: "", en: "" },
        source_type: "manual",
        source_id: nodeId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

interface QuestionForRevisionRow {
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

/**
 * Add a practice question to revision from the attempt-result review list.
 * front = the question stem, back = the correct option + explanation (both
 * bilingual) so a later FSRS review reads standalone, without the original
 * attempt context. Idempotent via the same (user_id, source_type, source_id)
 * unique index as addNodeToRevision, keyed by source_type='question'.
 */
export async function addQuestionToRevision(userId: string, questionId: string): Promise<SrsCard> {
  const { data: question, error: questionError } = await supabase()
    .from("questions")
    .select("stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .eq("id", questionId)
    .eq("is_published", true)
    .maybeSingle();
  if (questionError) throw new HttpError(500, `question lookup failed: ${questionError.message}`);
  if (!question) throw notFound("Question not found");

  const row = question as unknown as QuestionForRevisionRow;
  const correctOption = row.options_i18n?.find((o) => o.key === row.correct_option_key) ?? null;
  const back_i18n: BilingualText = {
    en: [
      correctOption ? `Answer: ${row.correct_option_key}. ${correctOption.text_i18n.en}` : null,
      row.explanation_i18n?.en,
    ]
      .filter((part): part is string => !!part)
      .join("\n\n"),
    hi: [
      correctOption ? `उत्तर: ${row.correct_option_key}. ${correctOption.text_i18n.hi}` : null,
      row.explanation_i18n?.hi,
    ]
      .filter((part): part is string => !!part)
      .join("\n\n"),
  };

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: row.stem_i18n,
        back_i18n,
        source_type: "question",
        source_id: questionId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}
