/**
 * Grounded MCQ explanation generation — the hardened replacement for the naive
 * "state the correct answer" prompt. The explanation is written from RAG
 * passages retrieved for the question's syllabus node (not the model's unaided
 * recall) and argues FOR the stored key.
 *
 * NOTE ON WRONG KEYS: we deliberately do NOT run a per-view "does the evidence
 * support the key?" gate here. A cheap haiku confirmation is unreliable on the
 * dominant UPPSC "consider the following statements / which are correct" format —
 * it reads a deliberately-FALSE statement (the very thing that makes one option
 * correct) as evidence the key is wrong, and withholds/flags a correct question
 * (the "Load failed" this once caused). Reliable wrong-key detection is the job
 * of the re-solve audit (blind solve + web_search) and user reports; those hide
 * a genuinely wrong-keyed question, after which no explanation is served for it.
 *
 * Used by the on-demand /stream/explain endpoint (via groundingForExplain, which
 * supplies just the grounding block for the streamed prompt) and by the admin
 * "regenerate explanation" report action (generateGroundedExplanation).
 */
import type { BilingualText } from "@neev/shared";
import { MODELS } from "../lib/models.js";
import { structuredJson } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { retrieveGrounding, type GroundingResult } from "./evaluation/grounding.js";

interface ExplainQuestion {
  id: string;
  syllabus_node_id: string | null;
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
}

async function fetchQuestion(questionId: string): Promise<ExplainQuestion> {
  // No visibility filter — the admin regenerate path acts on already-hidden
  // (needs_review/unpublished) reported questions.
  const { data, error } = await supabase()
    .from("questions")
    .select("id, syllabus_node_id, stem_i18n, options_i18n, correct_option_key")
    .eq("id", questionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as unknown as ExplainQuestion;
}

function optionsEn(q: ExplainQuestion): string {
  return (q.options_i18n ?? []).map((o) => `${o.key}) ${o.text_i18n.en ?? o.text_i18n.hi ?? ""}`).join("\n");
}

export function groundingBlockText(g: GroundingResult): string {
  if (g.chunks.length === 0) return "No reference passages were retrieved; rely only on well-established, verifiable facts.";
  return g.chunks.map((c, i) => `${i + 1}. [${c.source_type}] ${c.chunk_text}`).join("\n");
}

// ---------------------------------------------------------------------------
// Grounded explanation authoring (argues FOR the stored key)
// ---------------------------------------------------------------------------
const EXPLAIN_SYSTEM =
  "You write UPPSC MCQ answer explanations for exam aspirants, in BOTH Hindi (Devanagari) and English. You are given the " +
  "correct option — write a concise explanation (3-5 sentences per language) that argues FOR that option using the " +
  "reference passages, and briefly why each other option is wrong. Ground every factual claim in the passages or " +
  "well-established knowledge; never invent a date, article, name, or number. Plain prose only — no markdown, no headers, " +
  "no bold/italic asterisks, no bullet lists. Return strict JSON only.";

const EXPLAIN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    explanation: {
      type: "object",
      additionalProperties: false,
      properties: { hi: { type: "string" }, en: { type: "string" } },
      required: ["hi", "en"],
    },
  },
  required: ["explanation"],
};

async function authorExplanation(q: ExplainQuestion, g: GroundingResult, userId?: string): Promise<BilingualText> {
  const correct = (q.options_i18n ?? []).find((o) => o.key === q.correct_option_key);
  const out = await structuredJson<{ explanation: BilingualText }>({
    model: MODELS.haiku,
    maxTokens: 1500,
    system: EXPLAIN_SYSTEM,
    content:
      `Question:\n${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n\nOptions:\n${optionsEn(q)}\n\n` +
      `Correct option: ${q.correct_option_key}` +
      (correct ? ` (${correct.text_i18n.en ?? correct.text_i18n.hi})` : "") +
      `\n\nReference passages:\n${groundingBlockText(g)}\n\nWrite the bilingual explanation.`,
    schema: EXPLAIN_SCHEMA,
    purpose: "mcq_explanation",
    userId,
  });
  return out.explanation;
}

async function writeExplanation(questionId: string, expl: BilingualText, force: boolean): Promise<void> {
  const q = supabase().from("questions").update({ explanation_i18n: expl }).eq("id", questionId);
  const { error } = await (force ? q : q.is("explanation_i18n", null));
  if (error) throw new HttpError(500, `explanation persist failed: ${error.message}`);
}

/**
 * Full grounded regeneration (used by the admin "regenerate explanation" report
 * action). Authors a grounded, argues-for-the-key explanation and persists it
 * (force-overwriting the reported one). If the admin instead believes the KEY is
 * wrong, they use the fix_key action, which corrects the key and clears the
 * explanation so it regenerates against the right answer.
 */
export async function generateGroundedExplanation(
  questionId: string,
  opts: { force?: boolean; userId?: string } = {},
): Promise<BilingualText> {
  const q = await fetchQuestion(questionId);
  const text = `${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n${optionsEn(q)}`;
  const g = await retrieveGrounding({ questionText: text, locale: "en", syllabusNodeId: q.syllabus_node_id, k: 6 });
  const expl = await authorExplanation(q, g, opts.userId);
  await writeExplanation(questionId, expl, opts.force ?? false);
  return expl;
}

/**
 * Grounding for the user-facing on-demand explanation — retrieves the node RAG
 * passages so the streamed explanation is grounded (the quality win), with no
 * per-view dispute gate (see the file header for why).
 */
export async function groundingForExplain(question: {
  syllabus_node_id?: string | null;
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
}): Promise<string> {
  const opts = (question.options_i18n ?? []).map((o) => `${o.key}) ${o.text_i18n.en ?? o.text_i18n.hi ?? ""}`).join("\n");
  const text = `${question.stem_i18n.en ?? question.stem_i18n.hi ?? ""}\n${opts}`;
  const g = await retrieveGrounding({ questionText: text, locale: "en", syllabusNodeId: question.syllabus_node_id ?? null, k: 6 });
  return groundingBlockText(g);
}
