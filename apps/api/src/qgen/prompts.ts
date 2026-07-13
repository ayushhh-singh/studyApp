/**
 * Prompt construction + JSON schemas for the four-stage question-generation
 * pipeline. Every stage exposes a build*Params() returning shared
 * StructuredParams (so the synchronous structuredJson path and the async
 * Message-Batches path send byte-identical prompts) plus a parse*() for the
 * result.
 *
 *   Stage A  generate   claude-sonnet-5   MCQ or descriptive, strict JSON, bilingual
 *   Stage B  critic     claude-sonnet-5   single-correct / plausibility / tone / syllabus / facts
 *   Stage C  verify     claude-haiku-4-5  blind answer (no key) → mismatch auto-rejects (MCQ only)
 *   Stage D  dedup      embeddings        cosine vs the node's existing bank (see dedup.ts)
 *
 * Model ids come from lib/models.ts. Prompt versions are documented in
 * docs/qgen.md; bump QGEN_PROMPT_VERSION on any prompt change so
 * generation_meta records which version produced a row.
 */
import { MODELS, type StructuredParams } from "../lib/anthropic.js";
import type { CriticVerdict, Difficulty, VerifyResult } from "@neev/shared";
import type { GroundingResult } from "../services/evaluation/grounding.js";

// qgen-v2 (question-bank trust hardening): the Stage-B critic now receives the
// node RAG passages and must enumerate the answer's decisive facts, each tagged
// grounded / well_established / unverifiable — any unverifiable fact hard-rejects
// the candidate (parseCritic). The Stage-C blind verify is now grounded too.
export const QGEN_PROMPT_VERSION = "qgen-v2";

interface BilingualPair {
  hi: string;
  en: string;
}

/** A real PYQ pulled from our bank to condition style (Stage A few-shot). */
export interface FewShotQuestion {
  year: number | null;
  difficulty: string;
  stem_i18n: BilingualPair;
  options_i18n: { key: string; text_i18n: BilingualPair }[] | null;
  correct_option_key: string | null;
}

/** The syllabus node we're generating for. */
export interface NodeContext {
  id: string;
  paperCode: string;
  stage: "prelims" | "mains";
  title_i18n: BilingualPair;
  description_i18n: BilingualPair | null;
}

const bilingual = {
  type: "object",
  additionalProperties: false,
  properties: { hi: { type: "string" }, en: { type: "string" } },
  required: ["hi", "en"],
} as const;

// ---------------------------------------------------------------------------
// Shared blocks (cached): few-shot examples + RAG grounding for the node.
// ---------------------------------------------------------------------------
function nodeLine(node: NodeContext): string {
  const desc = node.description_i18n?.en?.trim();
  return `Topic: ${node.title_i18n.en}${desc ? ` — ${desc}` : ""}\nPaper: ${node.paperCode} (${node.stage})`;
}

function fewShotBlock(examples: FewShotQuestion[]): string {
  if (examples.length === 0) {
    return "No sample past-year questions were available for this exact topic; follow the general UPPSC style described above.";
  }
  const lines = examples.map((q, i) => {
    const opts = (q.options_i18n ?? [])
      .map((o) => `    ${o.key}) ${o.text_i18n.en}  /  ${o.text_i18n.hi}`)
      .join("\n");
    return (
      `Example ${i + 1} (UPPSC${q.year ? ` ${q.year}` : ""}, difficulty ${q.difficulty}):\n` +
      `  Stem EN: ${q.stem_i18n.en}\n` +
      `  Stem HI: ${q.stem_i18n.hi}\n` +
      (opts ? `  Options:\n${opts}\n` : "") +
      (q.correct_option_key ? `  Correct: ${q.correct_option_key}` : "")
    );
  });
  return `REAL UPPSC PAST-YEAR QUESTIONS FOR THIS TOPIC (match their stem length, option style, and trap patterns):\n\n${lines.join("\n\n")}`;
}

function groundingBlock(grounding: GroundingResult): string {
  if (grounding.chunks.length === 0) {
    return "No reference passages were retrieved. Use only well-established, verifiable facts about this topic from the UPPSC syllabus; do not invent specifics you are unsure of.";
  }
  const lines = grounding.chunks.map((c, i) => `${i + 1}. [${c.source_type}] ${c.chunk_text}`);
  return `REFERENCE PASSAGES (from the official UPPSC syllabus/PYQ store — base every factual claim ONLY on these or on well-established knowledge; never fabricate a statistic, date, article number, or scheme detail):\n${lines.join("\n")}`;
}

/** The per-node cached block: instructions tail + few-shot + grounding. Byte-identical across a node's chunks → prompt-cache hits after the first. */
function generationContextBlock(node: NodeContext, examples: FewShotQuestion[], grounding: GroundingResult): string {
  return `${nodeLine(node)}\n\n${fewShotBlock(examples)}\n\n${groundingBlock(grounding)}`;
}

// ---------------------------------------------------------------------------
// Stage A — MCQ generation (claude-sonnet-5, strict JSON, bilingual)
// ---------------------------------------------------------------------------
const MCQ_SYSTEM =
  "You are an experienced UPPSC (Uttar Pradesh Public Service Commission) Prelims question setter. You " +
  "write original, exam-standard objective questions in BOTH Hindi (Devanagari) and English. Rules for every question:\n" +
  "- Exactly 4 options keyed A, B, C, D, with EXACTLY ONE unambiguously correct answer; the other three must be " +
  "clearly wrong to a well-prepared aspirant, yet plausible enough to be real distractors (not jokes, not trivially absurd).\n" +
  "- The stem must be self-contained and answerable from the option set alone. Prefer UPPSC's real formats: single " +
  "statement, 'Consider the following statements', matching, assertion-reason, correctly-matched-pairs.\n" +
  "- Base every factual claim on the reference passages provided or on well-established knowledge; NEVER invent a " +
  "statistic, date, constitutional article, committee, or scheme detail. If you are not sure a fact is true, do not use it.\n" +
  "- Hindi and English must be faithful translations of each other. The explanation states why the correct option is " +
  "right and, briefly, why each other option is wrong. Plain text only — no markdown.\n" +
  "- Stay strictly within the given topic and paper's syllabus. Return strict JSON matching the schema.";

export interface GeneratedMcq {
  stem_i18n: BilingualPair;
  options: { key: string; text_i18n: BilingualPair }[];
  correct_option_key: string;
  explanation_i18n: BilingualPair;
  difficulty: Difficulty;
}

export const MCQ_GEN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stem_i18n: bilingual,
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { key: { type: "string", enum: ["A", "B", "C", "D"] }, text_i18n: bilingual },
              required: ["key", "text_i18n"],
            },
          },
          correct_option_key: { type: "string", enum: ["A", "B", "C", "D"] },
          explanation_i18n: bilingual,
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        },
        required: ["stem_i18n", "options", "correct_option_key", "explanation_i18n", "difficulty"],
      },
    },
  },
  required: ["questions"],
};

export function buildMcqGenParams(opts: {
  node: NodeContext;
  examples: FewShotQuestion[];
  grounding: GroundingResult;
  count: number;
  difficultyHint: string;
  variantHint: string;
}): StructuredParams {
  return {
    model: MODELS.sonnet,
    effort: "medium",
    maxTokens: 8000,
    system: [
      { text: MCQ_SYSTEM },
      { text: generationContextBlock(opts.node, opts.examples, opts.grounding), cache: true },
    ],
    content:
      `Generate ${opts.count} distinct UPPSC-Prelims MCQs on the topic above. ${opts.difficultyHint} ` +
      `${opts.variantHint} Make them genuinely different from one another in the sub-aspect they test. ` +
      `Return JSON only.`,
    schema: MCQ_GEN_SCHEMA,
  };
}

export function parseMcqGen(json: unknown): GeneratedMcq[] {
  return (json as { questions?: GeneratedMcq[] }).questions ?? [];
}

// ---------------------------------------------------------------------------
// Stage A — descriptive (Mains) generation
// ---------------------------------------------------------------------------
const DESC_SYSTEM =
  "You are an experienced UPPSC Mains paper setter. You write original, exam-standard DESCRIPTIVE (long-answer) " +
  "questions in BOTH Hindi (Devanagari) and English. Rules for every question:\n" +
  "- Open with a real UPPSC directive verb (Examine / Critically analyse / Discuss / Evaluate / Comment / To what " +
  "extent / Elucidate) and demand analysis, not mere recall.\n" +
  "- Assign realistic marks and a word limit that match UPPSC Mains norms (typically 125 words / 7 marks, or 200 " +
  "words / 10 marks; longer for higher marks).\n" +
  "- Provide a marking-points outline: 4-7 crisp points a strong answer must cover (used later to ground the " +
  "AI evaluator). Give the outline in BOTH languages, same points in the same order.\n" +
  "- Stay strictly within the given topic and paper's syllabus, and ground every factual expectation in the reference " +
  "passages or well-established knowledge. Hindi and English must be faithful translations. Return strict JSON.";

export interface GeneratedDescriptive {
  stem_i18n: BilingualPair;
  marks: number;
  word_limit: number;
  marking_points_i18n: { hi: string[]; en: string[] };
  difficulty: Difficulty;
}

export const DESC_GEN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stem_i18n: bilingual,
          marks: { type: "integer" },
          word_limit: { type: "integer" },
          marking_points_i18n: {
            type: "object",
            additionalProperties: false,
            properties: {
              hi: { type: "array", items: { type: "string" } },
              en: { type: "array", items: { type: "string" } },
            },
            required: ["hi", "en"],
          },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        },
        required: ["stem_i18n", "marks", "word_limit", "marking_points_i18n", "difficulty"],
      },
    },
  },
  required: ["questions"],
};

export function buildDescGenParams(opts: {
  node: NodeContext;
  examples: FewShotQuestion[];
  grounding: GroundingResult;
  count: number;
  difficultyHint: string;
  variantHint: string;
}): StructuredParams {
  return {
    model: MODELS.sonnet,
    effort: "medium",
    maxTokens: 8000,
    system: [
      { text: DESC_SYSTEM },
      { text: generationContextBlock(opts.node, opts.examples, opts.grounding), cache: true },
    ],
    content:
      `Generate ${opts.count} distinct UPPSC-Mains descriptive questions on the topic above. ${opts.difficultyHint} ` +
      `${opts.variantHint} Vary the directive verb and the sub-theme across the set. Return JSON only.`,
    schema: DESC_GEN_SCHEMA,
  };
}

export function parseDescGen(json: unknown): GeneratedDescriptive[] {
  return (json as { questions?: GeneratedDescriptive[] }).questions ?? [];
}

// ---------------------------------------------------------------------------
// Stage B — critic (claude-sonnet-5). One call per generated question.
// ---------------------------------------------------------------------------
const CRITIC_SYSTEM =
  "You are a strict UPPSC question-quality reviewer. You are given ONE candidate exam question (with its intended " +
  "answer/marking scheme), the syllabus topic it targets, and REFERENCE PASSAGES retrieved for that topic. Judge it " +
  "rigorously against the passages — do NOT rely on the question's own explanation for the facts. Return JSON:\n" +
  "- single_correct_answer: for an MCQ, is there EXACTLY ONE defensibly-correct option and are the other three " +
  "genuinely wrong? (for a descriptive question, is the task well-posed and answerable within its word limit?)\n" +
  "- options_plausible: are the distractors plausible and non-trivial (not obviously absurd, not near-duplicates of " +
  "the answer)? (descriptive: is the marking outline complete and on-point?)\n" +
  "- uppsc_tone: does it read like a real UPPSC question in difficulty, phrasing, and format?\n" +
  "- out_of_syllabus: is any part outside the stated topic/paper syllabus?\n" +
  "- decisive_facts: list EVERY proper noun, date, article/section number, statistic, or named person/scheme the " +
  "answer turns on. For each, set status = 'grounded' if a reference passage supports it, 'well_established' if it is " +
  "basic knowledge you are certain of, or 'unverifiable' if neither. Be honest — do not upgrade a fact you are only " +
  "guessing at.\n" +
  "- factual_red_flags: list any statement that is factually wrong (empty array if none).\n" +
  "- notes: one or two sentences on the main issue, or praise if clean.\n" +
  "- approve: true ONLY if it is single-correct (or well-posed), plausible, on-tone, in-syllabus, has NO factual red " +
  "flags, and NO decisive fact is 'unverifiable'. We do not publish unverifiable trivia. Be conservative — reject " +
  "anything you would not put in front of a real aspirant.\n" +
  "Return strict JSON only.";

export const CRITIC_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    single_correct_answer: { type: "boolean" },
    options_plausible: { type: "boolean" },
    uppsc_tone: { type: "boolean" },
    out_of_syllabus: { type: "boolean" },
    decisive_facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fact: { type: "string" },
          status: { type: "string", enum: ["grounded", "well_established", "unverifiable"] },
        },
        required: ["fact", "status"],
      },
    },
    factual_red_flags: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    approve: { type: "boolean" },
  },
  required: [
    "single_correct_answer",
    "options_plausible",
    "uppsc_tone",
    "out_of_syllabus",
    "decisive_facts",
    "factual_red_flags",
    "notes",
    "approve",
  ],
};

function renderMcqForCritic(q: GeneratedMcq): string {
  const opts = q.options.map((o) => `  ${o.key}) ${o.text_i18n.en}`).join("\n");
  return (
    `Type: MCQ\nStem: ${q.stem_i18n.en}\nOptions:\n${opts}\n` +
    `Intended correct answer: ${q.correct_option_key}\nExplanation given: ${q.explanation_i18n.en}`
  );
}

function renderDescForCritic(q: GeneratedDescriptive): string {
  return (
    `Type: Descriptive (Mains)\nQuestion: ${q.stem_i18n.en}\nMarks: ${q.marks} | Word limit: ${q.word_limit}\n` +
    `Marking points:\n${q.marking_points_i18n.en.map((p) => `  - ${p}`).join("\n")}`
  );
}

export function buildCriticParams(opts: { node: NodeContext; rendered: string; grounding: GroundingResult }): StructuredParams {
  return {
    model: MODELS.sonnet,
    effort: "medium",
    maxTokens: 1600,
    system: [{ text: CRITIC_SYSTEM, cache: true }],
    content:
      `SYLLABUS TOPIC:\n${nodeLine(opts.node)}\n\n${groundingBlock(opts.grounding)}\n\n` +
      `CANDIDATE QUESTION:\n${opts.rendered}\n\nReturn your JSON verdict.`,
    schema: CRITIC_SCHEMA,
  };
}

export const renderQuestionForCritic = { mcq: renderMcqForCritic, descriptive: renderDescForCritic };

export function parseCritic(json: unknown): CriticVerdict {
  const v = json as CriticVerdict;
  const decisiveFacts = Array.isArray(v.decisive_facts) ? v.decisive_facts : [];
  const hasUnverifiable = decisiveFacts.some((f) => f.status === "unverifiable");
  return {
    // Hard gate: any unverifiable decisive fact forces rejection even if the
    // model set approve=true — we do not publish unverifiable trivia.
    approve: !!v.approve && !hasUnverifiable,
    single_correct_answer: !!v.single_correct_answer,
    options_plausible: !!v.options_plausible,
    uppsc_tone: !!v.uppsc_tone,
    out_of_syllabus: !!v.out_of_syllabus,
    decisive_facts: decisiveFacts,
    factual_red_flags: Array.isArray(v.factual_red_flags) ? v.factual_red_flags : [],
    notes: typeof v.notes === "string" ? v.notes : "",
  };
}

// ---------------------------------------------------------------------------
// Stage C — blind verify (claude-haiku-4-5). MCQ only; the key is HIDDEN.
// ---------------------------------------------------------------------------
const VERIFY_SYSTEM =
  "You are a top UPPSC aspirant sitting the exam. You are shown one multiple-choice question, its four options, and " +
  "some REFERENCE PASSAGES, with NO answer key. Choose the single best option using the passages and your own " +
  "well-established knowledge. Return JSON: chosen_key (A/B/C/D) and confidence (0 to 1). If two options seem equally " +
  "correct or none is correct, pick the closest and set a low confidence. Do not explain. Return strict JSON only.";

export const VERIFY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    chosen_key: { type: "string", enum: ["A", "B", "C", "D"] },
    confidence: { type: "number" },
  },
  required: ["chosen_key", "confidence"],
};

export function buildVerifyParams(opts: {
  stemEn: string;
  options: { key: string; text_i18n: BilingualPair }[];
  grounding: GroundingResult;
}): StructuredParams {
  const opts_ = opts.options.map((o) => `${o.key}) ${o.text_i18n.en}`).join("\n");
  return {
    model: MODELS.haiku,
    maxTokens: 400,
    system: [{ text: VERIFY_SYSTEM, cache: true }],
    content:
      `Question:\n${opts.stemEn}\n\nOptions:\n${opts_}\n\n` +
      `Reference passages:\n${groundingBlock(opts.grounding)}\n\nWhich option is correct?`,
    schema: VERIFY_SCHEMA,
  };
}

export function parseVerify(json: unknown, expectedKey: string): VerifyResult {
  const v = json as { chosen_key?: string; confidence?: number };
  const chosen = v.chosen_key ?? null;
  const confidence = typeof v.confidence === "number" ? Math.min(1, Math.max(0, v.confidence)) : null;
  return { chosen_key: chosen, matches_key: chosen === expectedKey, confidence };
}
