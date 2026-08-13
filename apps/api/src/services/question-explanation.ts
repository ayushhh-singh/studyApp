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
import { examCodeForNode } from "../lib/exams.js";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";
import { EXPLANATION_DEPTH_SPEC, EXPLANATION_FORMAT_RULE } from "../lib/explanation-depth.js";

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
/**
 * Memoise each exam's assembled system prompt — these were module-level consts
 * (one string instance, one prompt-cache-friendly identity); per-exam functions
 * keep that property PER EXAM instead of rebuilding on every call. Same helper
 * shape as `qgen/prompts.ts`'s.
 */
function memoisePerExam(build: (examCode: string) => string): (examCode: string) => string {
  const cache = new Map<string, string>();
  return (examCode: string) => {
    const hit = cache.get(examCode);
    if (hit !== undefined) return hit;
    const built = build(examCode);
    cache.set(examCode, built);
    return built;
  };
}

/**
 * Exported (was a module-private `EXPLAIN_SYSTEM` const) so `pnpm prompts:snapshot`
 * can diff it by string without issuing the model call that used to be the only
 * way to read it.
 */
export const explainSystem = memoisePerExam(
  (examCode) =>
    `You write ${requireAuthored(getExamConfig(examCode).misc.explanationFraming, examCode, "misc.explanationFraming")} for exam aspirants, in BOTH Hindi (Devanagari) and English. You are given the ` +
    `correct option. ${EXPLANATION_DEPTH_SPEC}\n` +
    "Ground every factual claim in the reference passages or in well-established knowledge; never invent a date, " +
    "article, name, or number. Where the passages do not settle a particular wrong option, say plainly why it is " +
    "wrong on well-established grounds rather than inventing a specific to justify it.\n" +
    "Write BOTH languages in full: the Hindi must stand on its own as a complete explanation, not a shortened " +
    `summary of the English. ${EXPLANATION_FORMAT_RULE} Return strict JSON only.`,
);

/**
 * The system prompt for the STREAMED on-demand explanation served by
 * `routes/stream.ts`'s `GET /stream/explain/:questionId`.
 *
 * It lives here, next to that endpoint's `groundingForExplain`, rather than
 * inline in the route: as an anonymous literal inside a router closure it was
 * unreachable by `pnpm prompts:snapshot` without a live HTTP request, so a
 * refactor could silently reword it. This module is already the owner of the
 * endpoint's prompt inputs (see the header), which is why it is the natural home.
 *
 * Distinct from `explainSystem` above — that one writes a BILINGUAL, persisted
 * JSON explanation; this one streams prose in ONE locale.
 */
export const streamExplainSystem = memoisePerExam(
  (examCode) =>
    `You explain ${requireAuthored(getExamConfig(examCode).misc.streamExplanationFraming, examCode, "misc.streamExplanationFraming")} for exam aspirants, in ONE language. ` +
    `${EXPLANATION_DEPTH_SPEC}\n` +
    "Ground every factual claim in the reference passages or in well-established knowledge; never invent a date, " +
    "article, name, or number. Where the passages do not settle a particular wrong option, say plainly why it is " +
    `wrong on well-established grounds rather than inventing a specific to justify it.\n${EXPLANATION_FORMAT_RULE}`,
);

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

async function authorExplanation(
  q: ExplainQuestion,
  g: GroundingResult,
  examCode: string,
  userId?: string,
): Promise<BilingualText> {
  const correct = (q.options_i18n ?? []).find((o) => o.key === q.correct_option_key);
  const out = await structuredJson<{ explanation: BilingualText }>({
    model: MODELS.haiku,
    // 1500 before the depth rewrite, sized for a 3-5 sentence pair. The binding
    // constraint is Devanagari, MEASURED on this bank's own text at ~1.43
    // chars/token against English's ~4.74 — 3.3x more tokens for the same prose,
    // so a bilingual explanation is dominated by its Hindi half. At the length
    // real answer keys actually run (~200 words for a multi-statement item, so
    // ~1,200 characters per language) that is ~250 (en) + ~840 (hi) + JSON
    // scaffolding ≈ 1,140 tokens: survivable under the old 1500, but with no
    // margin for the longer tail, and truncation there means a silent 1.75x
    // retry or an outright TruncatedResponseError. A ceiling is not a spend —
    // raising it costs nothing on the calls that never approach it.
    maxTokens: 3000,
    system: explainSystem(examCode),
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
  // The exam that owns the question's node, not its provenance exam_code —
  // scopes BOTH the retrieval and the explanation's own exam framing.
  const examCode = await examCodeForNode(q.syllabus_node_id);
  const g = await retrieveGrounding({
    questionText: text,
    locale: "en",
    syllabusNodeId: q.syllabus_node_id,
    examCode,
    k: 6,
  });
  const expl = await authorExplanation(q, g, examCode, opts.userId);
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
  const g = await retrieveGrounding({
    questionText: text,
    locale: "en",
    syllabusNodeId: question.syllabus_node_id ?? null,
    examCode: await examCodeForNode(question.syllabus_node_id),
    k: 6,
  });
  return groundingBlockText(g);
}
