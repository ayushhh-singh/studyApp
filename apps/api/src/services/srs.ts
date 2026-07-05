import { createHash } from "node:crypto";
import type { BilingualText, EvaluationAnalysis, Locale, SrsCard } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";

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

interface SubmissionForRevisionRow {
  user_id: string;
  language: Locale;
  custom_question_text_i18n: BilingualText | null;
  questions: { stem_i18n: BilingualText } | null;
}

interface EvaluationForRevisionRow {
  raw_response: { analysis?: EvaluationAnalysis } | null;
}

/**
 * Save an evaluated answer's key points to revision. front = the question
 * text (catalogued stem or the user's own prompt), back = the reference
 * points + missed key points from the analysis, in whichever locale the
 * submission was written in (evaluation feedback is single-locale, same as
 * strengths/improvements/model_answer). Reuses source_type='manual' (like
 * addNodeToRevision) keyed by the submission id, rather than adding a new
 * enum value for a one-off source.
 */
export async function addEvaluationToRevision(userId: string, submissionId: string): Promise<SrsCard> {
  const { data: submission, error: subError } = await supabase()
    .from("answer_submissions")
    .select("user_id, language, custom_question_text_i18n, questions(stem_i18n)")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw new HttpError(500, `submission lookup failed: ${subError.message}`);
  const row = submission as unknown as SubmissionForRevisionRow | null;
  if (!row || row.user_id !== userId) throw notFound("Submission not found");

  const { data: evaluation, error: evalError } = await supabase()
    .from("evaluations")
    .select("raw_response")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (evalError) throw new HttpError(500, `evaluation lookup failed: ${evalError.message}`);
  const analysis = (evaluation as unknown as EvaluationForRevisionRow | null)?.raw_response?.analysis;
  if (!analysis) throw badRequest("This submission has no evaluation to save yet");

  const front_i18n = row.questions?.stem_i18n ?? row.custom_question_text_i18n ?? { hi: "", en: "" };
  const points = [...analysis.reference_points, ...analysis.missed_key_points];
  const backText = points.length ? points.map((p) => `- ${p}`).join("\n") : "";
  const back_i18n: BilingualText = row.language === "hi" ? { hi: backText, en: "" } : { hi: "", en: backText };

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n,
        back_i18n,
        source_type: "manual",
        source_id: submissionId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

interface CurrentAffairsItemForFactRow {
  title_i18n: BilingualText;
  key_facts_i18n: { hi: string[]; en: string[] } | null;
}

/**
 * source_id is a `uuid` column, but "one card per fact" needs a distinct key
 * per (item, fact index) — not just per item. Rather than widen the column
 * (source_id is already "FK-by-convention", never a real FK per the srs_cards
 * comment), derive a stable, deterministic uuid-shaped id from the pair. Same
 * (itemId, factIndex) always hashes to the same id, so the existing
 * (user_id, source_type, source_id) unique index still makes re-adding the
 * same fact idempotent, while different facts on the same item get distinct
 * cards.
 */
function currentAffairsFactSourceId(itemId: string, factIndex: number): string {
  const hash = createHash("sha256").update(`${itemId}:${factIndex}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Add one current-affairs "key fact" bullet to revision. front = the item's
 * title, back = that single fact (both locales) — deliberately not the whole
 * item, so a later FSRS review is one focused, memorizable claim rather than
 * a wall of bullets.
 */
export async function addCurrentAffairsFactToRevision(
  userId: string,
  itemId: string,
  factIndex: number,
): Promise<SrsCard> {
  const { data: item, error: itemError } = await supabase()
    .from("current_affairs_items")
    .select("title_i18n, detail_i18n->key_facts_i18n")
    .eq("id", itemId)
    .eq("is_published", true)
    .maybeSingle();
  if (itemError) throw new HttpError(500, `current affairs item lookup failed: ${itemError.message}`);
  const row = item as unknown as CurrentAffairsItemForFactRow | null;
  if (!row) throw notFound("Current affairs item not found");

  const facts = row.key_facts_i18n;
  const hi = facts?.hi?.[factIndex];
  const en = facts?.en?.[factIndex];
  if (!hi && !en) throw badRequest("This item has no key fact at that index");

  const { data: card, error: upsertError } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: row.title_i18n,
        back_i18n: { hi: hi ?? "", en: en ?? "" },
        source_type: "current_affairs",
        source_id: currentAffairsFactSourceId(itemId, factIndex),
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (upsertError) throw new HttpError(500, `srs card upsert failed: ${upsertError.message}`);
  return card as unknown as SrsCardRow;
}
