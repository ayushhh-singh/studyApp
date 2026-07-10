/**
 * Grounded MCQ explanation generation — the hardened replacement for the naive
 * "state the correct answer" prompt. Two guarantees, both aimed at the failure
 * that let wrong PYQ explanations ship:
 *
 *  1. GROUNDED — the explanation is written from RAG passages retrieved for the
 *     question's syllabus node, not the model's unaided recall.
 *  2. KEY IS GROUND TRUTH, but not blindly — before writing an explanation that
 *     argues FOR the stored key, a cheap grounded pre-check asks whether the
 *     evidence actually supports that key. If it does not, we DO NOT fabricate a
 *     justification for a key we don't trust: the question is flagged
 *     (needs_review + unpublished) for a human, and no explanation is written.
 *     This is exactly the case that produced the Somnath explanation.
 *
 * Used by the on-demand /stream/explain endpoint (via prepareGroundedExplain)
 * and by the admin "regenerate explanation" report action (generateGroundedExplanation).
 */
import type { BilingualText } from "@prayasup/shared";
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
// Grounded key-support pre-check
// ---------------------------------------------------------------------------
const SUPPORT_SYSTEM =
  "You are auditing a UPPSC exam MCQ before an explanation is written for it. You are given the question, its options, " +
  "reference passages, and the STORED answer key. Using the passages and well-established knowledge, decide whether the " +
  "evidence genuinely supports the stored key being the single correct option. Do NOT assume the stored key is right — " +
  "check it. If it is clearly wrong, say which option the evidence actually supports. Name the decisive fact. Return strict JSON only.";

const SUPPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    supports_key: { type: "boolean" },
    believed_key: { type: "string", enum: ["A", "B", "C", "D", "unsure"] },
    decisive_fact: { type: "string" },
    reason: { type: "string" },
  },
  required: ["supports_key", "believed_key", "decisive_fact", "reason"],
};

export interface KeySupport {
  supports_key: boolean;
  believed_key: string;
  decisive_fact: string;
  reason: string;
}

export async function checkKeySupport(q: ExplainQuestion, g: GroundingResult, userId?: string): Promise<KeySupport> {
  return structuredJson<KeySupport>({
    model: MODELS.haiku,
    maxTokens: 500,
    system: SUPPORT_SYSTEM,
    content:
      `Question:\n${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n\nOptions:\n${optionsEn(q)}\n\n` +
      `Stored answer key: ${q.correct_option_key ?? "unknown"}\n\nReference passages:\n${groundingBlockText(g)}\n\n` +
      `Does the evidence support the stored key?`,
    schema: SUPPORT_SCHEMA,
    purpose: "explanation_key_check",
    userId,
  });
}

/** Flag a question whose stored key the evidence disputes: needs_review + unpublished. */
export async function flagKeyDispute(questionId: string, support: KeySupport): Promise<void> {
  const { data, error: readErr } = await supabase().from("questions").select("meta").eq("id", questionId).maybeSingle();
  if (readErr) throw new HttpError(500, `flagKeyDispute read failed: ${readErr.message}`);
  const meta = ((data?.meta as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const nextMeta = {
    ...meta,
    audit_flag: {
      kind: "explanation_key_dispute",
      reason: support.reason,
      believed_key: support.believed_key,
      decisive_fact: support.decisive_fact,
      at: new Date().toISOString(),
    },
  };
  const { error } = await supabase()
    .from("questions")
    .update({ review_state: "needs_review", is_published: false, meta: nextMeta })
    .eq("id", questionId);
  if (error) throw new HttpError(500, `flagKeyDispute update failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Grounded explanation authoring (argues FOR the stored key)
// ---------------------------------------------------------------------------
const EXPLAIN_SYSTEM =
  "You write UPPSC MCQ answer explanations for exam aspirants, in BOTH Hindi (Devanagari) and English. You are given the " +
  "verified correct option — write a concise explanation (3-5 sentences per language) that argues FOR that option using " +
  "the reference passages, and briefly why each other option is wrong. Ground every factual claim in the passages or " +
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
      `Verified correct option: ${q.correct_option_key}` +
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

export interface GroundedExplanationResult {
  disputed: boolean;
  reason?: string;
  believed_key?: string;
  explanation_i18n?: BilingualText;
}

/**
 * Full grounded regeneration (used by the admin report action). Runs the
 * key-support pre-check; on dispute, flags the question and returns without
 * writing. Otherwise authors a grounded, argues-for-the-key explanation and
 * persists it (force-overwriting the reported one when force=true).
 */
export async function generateGroundedExplanation(
  questionId: string,
  opts: { force?: boolean; userId?: string } = {},
): Promise<GroundedExplanationResult> {
  const q = await fetchQuestion(questionId);
  const text = `${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n${optionsEn(q)}`;
  const g = await retrieveGrounding({ questionText: text, locale: "en", syllabusNodeId: q.syllabus_node_id, k: 6 });
  const support = await checkKeySupport(q, g, opts.userId);
  if (!support.supports_key) {
    await flagKeyDispute(questionId, support);
    return { disputed: true, reason: support.reason, believed_key: support.believed_key };
  }
  const expl = await authorExplanation(q, g, opts.userId);
  await writeExplanation(questionId, expl, opts.force ?? false);
  return { disputed: false, explanation_i18n: expl };
}

/**
 * Streaming-endpoint helper: retrieves grounding + runs the key-support
 * pre-check. On dispute, flags the question and returns disputed=true (the SSE
 * route should then withhold the explanation). Otherwise returns the grounding
 * block to inject into the streamed prompt so the explanation is grounded.
 */
export async function prepareGroundedExplain(question: {
  id: string;
  syllabus_node_id?: string | null;
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
}): Promise<{ disputed: true; reason: string } | { disputed: false; groundingBlock: string }> {
  const q: ExplainQuestion = {
    id: question.id,
    syllabus_node_id: question.syllabus_node_id ?? null,
    stem_i18n: question.stem_i18n,
    options_i18n: question.options_i18n,
    correct_option_key: question.correct_option_key,
  };
  const text = `${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n${optionsEn(q)}`;
  const g = await retrieveGrounding({ questionText: text, locale: "en", syllabusNodeId: q.syllabus_node_id, k: 6 });
  const support = await checkKeySupport(q, g);
  if (!support.supports_key) {
    await flagKeyDispute(q.id, support);
    return { disputed: true, reason: support.reason };
  }
  return { disputed: false, groundingBlock: groundingBlockText(g) };
}
