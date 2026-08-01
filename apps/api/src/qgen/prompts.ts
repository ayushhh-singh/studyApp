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
import { getExamConfig, isAuthored, requireAuthored, type ExamQgenCsatConfig } from "../lib/exam-config.js";
import type { CriticVerdict, Difficulty, VerifyResult } from "@neev/shared";
import type { GroundingResult } from "../services/evaluation/grounding.js";

/**
 * Every exam-specific string below comes from `lib/exam-config.ts`, unwrapped
 * through `requireAuthored` so an exam whose question-setting style has not been
 * authored fails LOUDLY at prompt-build time rather than silently generating
 * questions in a different commission's format (U6).
 *
 * CACHE BOUNDARY — read before moving any of this:
 *  - `buildMcqGenParams`/`buildDescGenParams` send TWO system segments:
 *    [0] the persona (`mcqSystem`/`descSystem`, no cache flag) and
 *    [1] `generationContextBlock(...)` marked cache:true. The cached prefix is
 *    [0] + [1] — a breakpoint caches everything BEFORE it — so per-exam text in
 *    the "uncached-looking" [0] still shapes the cache. That is fine: it
 *    PARTITIONS the entry per exam (one stable prefix each). Putting anything
 *    PER-REQUEST in [0] would make the prefix vary per call and destroy [1]'s
 *    entry outright.
 *  - `buildCriticParams`/`buildVerifyParams` send ONE cache:true segment. These
 *    were module-level consts with a single global cache entry; reading the exam
 *    makes them per-exam functions, i.e. one entry PER EXAM. Also a partition.
 *    They are memoised below so repeated calls reuse one string instance.
 */
function qgenConfig(examCode: string) {
  return getExamConfig(examCode).qgen;
}

/**
 * This exam's aptitude-paper (CSAT) question-setting norm IF the node sits on
 * that paper AND the exam has authored one — otherwise `null`, meaning "treat
 * this node exactly as a General Studies Prelims node", which is the behaviour
 * every exam had before this slot existed.
 *
 * Keyed off `papers.prelimsCsat` rather than a `PRE_CSAT` substring: paper codes
 * are exam-PREFIXED for every non-default exam (`UPSC_PRE_CSAT`), so a pattern
 * match is both wrong and the exact shape (M23) that once let one exam's PYQs
 * attach to another's syllabus tree. The registry already holds the answer.
 *
 * Exported because `qgen/generate.ts`'s `loadFewShot` gates on the same
 * condition: an exam that has authored a distinct CSAT norm has also declared
 * that its CSAT topics are separate SKILLS, which is what makes a paper-wide
 * few-shot fallback wrong for them. One predicate, two consequences.
 */
export function csatQgenConfigFor(examCode: string, paperCode: string): ExamQgenCsatConfig | null {
  const cfg = getExamConfig(examCode);
  if (!cfg.papers.prelimsCsat || paperCode !== cfg.papers.prelimsCsat) return null;
  const csat = cfg.qgen.csat;
  // UNAUTHORED here is NOT a hard failure the way a missing persona is: the
  // caller's fallback is this exam's own general prelims norm, not another
  // exam's text, so nothing is borrowed across commissions. `formatGuidance`
  // still throws for a wholly unauthored exam.
  return isAuthored(csat) ? csat : null;
}

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
  /** Product exam that owns this node — the retrieval scope for generation. */
  examCode: string;
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

/**
 * @param examCode which exam's few-shot framing to use. REQUIRED — never give
 *   this a default: a defaulted trailing parameter lets a caller silently keep
 *   the old behaviour (this repo's M24 lesson). Both call sites pass a real
 *   exam: `buildSharedBlocks` passes `node.examCode`, and `ca/prompts.ts`'s
 *   `generateMcqs` passes its own `examCode` (multi-exam slice 2c).
 */
export function fewShotBlock(examples: FewShotQuestion[], examCode: string): string {
  const cfg = qgenConfig(examCode);
  if (examples.length === 0) {
    return requireAuthored(cfg.fewShotFallback, examCode, "qgen.fewShotFallback");
  }
  const attribution = requireAuthored(cfg.fewShotAttribution, examCode, "qgen.fewShotAttribution");
  const lines = examples.map((q, i) => {
    const opts = (q.options_i18n ?? [])
      .map((o) => `    ${o.key}) ${o.text_i18n.en}  /  ${o.text_i18n.hi}`)
      .join("\n");
    return (
      `Example ${i + 1} (${attribution}${q.year ? ` ${q.year}` : ""}, difficulty ${q.difficulty}):\n` +
      `  Stem EN: ${q.stem_i18n.en}\n` +
      `  Stem HI: ${q.stem_i18n.hi}\n` +
      (opts ? `  Options:\n${opts}\n` : "") +
      (q.correct_option_key ? `  Correct: ${q.correct_option_key}` : "")
    );
  });
  return `${requireAuthored(cfg.fewShotHeader, examCode, "qgen.fewShotHeader")}\n\n${lines.join("\n\n")}`;
}

function groundingBlock(grounding: GroundingResult, examCode: string): string {
  const cfg = qgenConfig(examCode);
  if (grounding.chunks.length === 0) {
    const fallback = requireAuthored(cfg.groundingFallbackLabel, examCode, "qgen.groundingFallbackLabel");
    return `No reference passages were retrieved. Use only well-established, verifiable facts about this topic from ${fallback}; do not invent specifics you are unsure of.`;
  }
  const store = requireAuthored(cfg.groundingStoreLabel, examCode, "qgen.groundingStoreLabel");
  const lines = grounding.chunks.map((c, i) => `${i + 1}. [${c.source_type}] ${c.chunk_text}`);
  return `REFERENCE PASSAGES (from the ${store} — base every factual claim ONLY on these or on well-established knowledge; never fabricate a statistic, date, article number, or scheme detail):\n${lines.join("\n")}`;
}

/** The per-node cached block: instructions tail + few-shot + grounding. Byte-identical across a node's chunks → prompt-cache hits after the first. */
function generationContextBlock(node: NodeContext, examples: FewShotQuestion[], grounding: GroundingResult): string {
  return `${nodeLine(node)}\n\n${fewShotBlock(examples, node.examCode)}\n\n${groundingBlock(grounding, node.examCode)}`;
}

// ---------------------------------------------------------------------------
// Stage A — MCQ generation (claude-sonnet-5, strict JSON, bilingual)
// ---------------------------------------------------------------------------
/**
 * Memoise each exam's assembled system prompt. These were module-level consts
 * (one string instance, one global prompt-cache entry); per-exam functions keep
 * the same property PER EXAM instead of rebuilding the string on every call.
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
 * As `memoisePerExam`, but keyed by (exam, is-this-the-aptitude-paper) — the two
 * inputs `mcqSystem` varies on. The CSAT config itself is not part of the key:
 * it is derived from the exam, so `examCode + "|" + (csat ? "csat" : "gs")` is
 * total. At most two entries per exam, one per paper kind.
 */
function memoisePerExamAndPaperKind(
  build: (examCode: string, csat: ExamQgenCsatConfig | null) => string,
): (examCode: string, csat: ExamQgenCsatConfig | null) => string {
  const cache = new Map<string, string>();
  return (examCode: string, csat: ExamQgenCsatConfig | null) => {
    const key = `${examCode}|${csat ? "csat" : "gs"}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const built = build(examCode, csat);
    cache.set(key, built);
    return built;
  };
}

/**
 * The MCQ persona, memoised per (exam, paper kind).
 *
 * TWO KEYS, not one: an exam's aptitude paper gets a different format clause
 * from its General Studies paper (see `csatQgenConfigFor`). That still PARTITIONS
 * the prompt cache rather than destroying it — the entry count goes from one per
 * exam to at most two per exam, each a stable prefix. Only PER-REQUEST text in
 * segment [0] would kill [1]'s entry; see the cache note at the top of this file.
 *
 * An exam with no authored CSAT norm resolves both keys to the identical string,
 * so `uppsc` still builds exactly one prompt and one cache entry.
 */
const mcqSystem = memoisePerExamAndPaperKind((examCode, csat) => {
  const cfg = qgenConfig(examCode);
  // A CSAT node substitutes the aptitude norm for the GS one IN THE SAME SLOT,
  // rather than appending it: the failure this replaced was precisely a GS-shaped
  // body followed by a one-sentence CSAT exception, which the model did not honour.
  const formatClause = csat
    ? csat.formatGuidance
    : requireAuthored(cfg.formatGuidance, examCode, "qgen.formatGuidance");
  return (
  `You are ${requireAuthored(cfg.prelimsSetterFraming, examCode, "qgen.prelimsSetterFraming")}. You ` +
  "write original, exam-standard objective questions in BOTH Hindi (Devanagari) and English. Rules for every question:\n" +
  "- Exactly 4 options keyed A, B, C, D, with EXACTLY ONE unambiguously correct answer; the other three must be " +
  "clearly wrong to a well-prepared aspirant, yet plausible enough to be real distractors (not jokes, not trivially absurd).\n" +
  `- The stem must be self-contained and answerable from the option set alone. ${formatClause}\n` +
  "- Base every factual claim on the reference passages provided or on well-established knowledge; NEVER invent a " +
  "statistic, date, constitutional article, committee, or scheme detail. If you are not sure a fact is true, do not use it.\n" +
  "- Hindi and English must be faithful translations of each other. The explanation states why the correct option is " +
  "right and, briefly, why each other option is wrong. Plain text only — no markdown.\n" +
  (csat
    // Replaces the GS "stay within the topic's syllabus" close, which on an
    // aptitude paper reads as an instruction to test the topic's CONTENT — the
    // exact drift measured (theory-recall statement sets about the node title).
    ? "- The topic names the SKILL to exercise, not the subject matter to be tested: any everyday, workplace or " +
      "administrative context is fair game as the vehicle, provided solving the item requires that skill and no " +
      "outside knowledge. Use the reference passages only as realistic background — never as the thing being " +
      "recalled. Return strict JSON matching the schema."
    : "- Stay strictly within the given topic and paper's syllabus. Return strict JSON matching the schema.")
  );
});

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
      // [0] uncached-looking, but the cached PREFIX is [0]+[1] — see the cache
      // note at the top of this file. Per-exam text partitions; per-request kills.
      { text: mcqSystem(opts.node.examCode, csatQgenConfigFor(opts.node.examCode, opts.node.paperCode)) },
      { text: generationContextBlock(opts.node, opts.examples, opts.grounding), cache: true },
    ],
    // User content, so never inside a cached prefix. Deliberately reads qgen's OWN
    // label rather than the byte-identical `ca.mcqOutputLabel`: borrowing another
    // namespace's field would fork the config the first time one exam wants a
    // different phrasing for CA-derived vs bank-generated MCQs.
    content:
      `Generate ${opts.count} distinct ${requireAuthored(qgenConfig(opts.node.examCode).mcqOutputLabel, opts.node.examCode, "qgen.mcqOutputLabel")} on the topic above. ${opts.difficultyHint} ` +
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
const descSystem = memoisePerExam((examCode) => {
  const cfg = qgenConfig(examCode);
  return (
  `You are ${requireAuthored(cfg.mainsSetterFraming, examCode, "qgen.mainsSetterFraming")}. You write original, exam-standard DESCRIPTIVE (long-answer) ` +
  "questions in BOTH Hindi (Devanagari) and English. Rules for every question:\n" +
  `- Open with ${requireAuthored(cfg.directiveVerbGuidance, examCode, "qgen.directiveVerbGuidance")} and demand analysis, not mere recall.\n` +
  `- Assign realistic marks and a word limit that match ${requireAuthored(cfg.marksNormGuidance, examCode, "qgen.marksNormGuidance")}.\n` +
  "- Provide a marking-points outline: 4-7 crisp points a strong answer must cover (used later to ground the " +
  "AI evaluator). Give the outline in BOTH languages, same points in the same order.\n" +
  "- Stay strictly within the given topic and paper's syllabus, and ground every factual expectation in the reference " +
  "passages or well-established knowledge. Hindi and English must be faithful translations. Return strict JSON."
  );
});

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
      // Same [0]+[1] cached-prefix contract as buildMcqGenParams above.
      { text: descSystem(opts.node.examCode) },
      { text: generationContextBlock(opts.node, opts.examples, opts.grounding), cache: true },
    ],
    // User content, never inside a cached prefix.
    content:
      `Generate ${opts.count} distinct ${requireAuthored(qgenConfig(opts.node.examCode).descOutputLabel, opts.node.examCode, "qgen.descOutputLabel")} on the topic above. ${opts.difficultyHint} ` +
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
const criticSystem = memoisePerExamAndPaperKind((examCode, csat) => {
  const cfg = qgenConfig(examCode);
  // Same substitution as `mcqSystem`: the aptitude paper's criterion REPLACES
  // the General Studies one in the same slot. The critic is a hard gate
  // (`generate.ts` rejects on `!approve`, and approval requires "on-tone"), so
  // leaving the GS criterion here would keep SELECTING for the GS-shaped
  // recall items this change exists to stop generating. See
  // `ExamQgenCsatConfig.toneCriterion`.
  const toneClause = csat
    ? csat.toneCriterion
    : requireAuthored(cfg.toneCriterion, examCode, "qgen.toneCriterion");
  return (
  `You are ${requireAuthored(cfg.criticFraming, examCode, "qgen.criticFraming")}. You are given ONE candidate exam question (with its intended ` +
  "answer/marking scheme), the syllabus topic it targets, and REFERENCE PASSAGES retrieved for that topic. Judge it " +
  "rigorously against the passages — do NOT rely on the question's own explanation for the facts. Return JSON:\n" +
  "- single_correct_answer: for an MCQ, is there EXACTLY ONE defensibly-correct option and are the other three " +
  "genuinely wrong? (for a descriptive question, is the task well-posed and answerable within its word limit?)\n" +
  "- options_plausible: are the distractors plausible and non-trivial (not obviously absurd, not near-duplicates of " +
  "the answer)? (descriptive: is the marking outline complete and on-point?)\n" +
  // ⚠ `uppsc_tone` is NOT prompt copy — it is a key of CRITIC_SCHEMA, a required
  // field of CriticVerdict in @neev/shared, and a key inside every persisted
  // questions.generation_meta row. NEVER rename it. Only the human-readable
  // criterion text after the colon is exam-configurable.
  `- uppsc_tone: ${toneClause}\n` +
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
  "Return strict JSON only."
  );
});

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
    // NO-OP TODAY — the flag caches nothing, and the exam-config sweep did not
    // change that. MEASURED 2026-07-30 (countTokens): 611 tokens vs
    // claude-sonnet-5's 1024-token minimum cacheable prefix — 413 short. This
    // was equally a no-op BEFORE the sweep (it was a single module const then,
    // ~the same length), so per-exam partitioning costs nothing here; there is
    // simply no cache to partition. Left in place: harmless, and correct for
    // free if this prompt ever grows past 1024. See lib/anthropic.ts's
    // PromptSegment doc for why a below-minimum `cache: true` is silent.
    system: [
      { text: criticSystem(opts.node.examCode, csatQgenConfigFor(opts.node.examCode, opts.node.paperCode)), cache: true },
    ],
    content:
      `SYLLABUS TOPIC:\n${nodeLine(opts.node)}\n\n${groundingBlock(opts.grounding, opts.node.examCode)}\n\n` +
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
const verifySystem = memoisePerExam(
  (examCode) =>
    `You are ${requireAuthored(qgenConfig(examCode).verifierFraming, examCode, "qgen.verifierFraming")}. You are shown one multiple-choice question, its four options, and ` +
    "some REFERENCE PASSAGES, with NO answer key. Choose the single best option using the passages and your own " +
    "well-established knowledge. Return JSON: chosen_key (A/B/C/D) and confidence (0 to 1). If two options seem equally " +
    "correct or none is correct, pick the closest and set a low confidence. Do not explain. Return strict JSON only.",
);

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
  /**
   * REQUIRED — never give this a default (this repo's M24 lesson: a defaulted
   * trailing parameter lets a caller silently keep the old behaviour). All
   * three call sites pass a real exam: qgen's two sync/batch verify stages pass
   * `ctx.node.examCode`, and `ca/verify-mcqs.ts` resolves the question's node
   * exam (falling back to the default explicitly, at the call site, where it is
   * greppable).
   */
  examCode: string;
}): StructuredParams {
  const examCode = opts.examCode;
  const opts_ = opts.options.map((o) => `${o.key}) ${o.text_i18n.en}`).join("\n");
  return {
    model: MODELS.haiku,
    maxTokens: 400,
    // NO-OP TODAY, AND BY THE WIDEST MARGIN IN THE CODEBASE — MEASURED
    // 2026-07-30 (countTokens): 107 tokens against claude-haiku-4-5's
    // 4096-token minimum. That is ~38x short, and the reason is the model, not
    // the prompt: haiku-4-5's minimum is FOUR TIMES sonnet-5's 1024, so a
    // prompt that would cache fine on sonnet caches nothing here. No realistic
    // growth of this prompt reaches 4096. Left in place as harmless. See
    // lib/anthropic.ts's PromptSegment doc.
    system: [{ text: verifySystem(examCode), cache: true }],
    content:
      `Question:\n${opts.stemEn}\n\nOptions:\n${opts_}\n\n` +
      `Reference passages:\n${groundingBlock(opts.grounding, examCode)}\n\nWhich option is correct?`,
    schema: VERIFY_SCHEMA,
  };
}

export function parseVerify(json: unknown, expectedKey: string): VerifyResult {
  const v = json as { chosen_key?: string; confidence?: number };
  const chosen = v.chosen_key ?? null;
  const confidence = typeof v.confidence === "number" ? Math.min(1, Math.max(0, v.confidence)) : null;
  return { chosen_key: chosen, matches_key: chosen === expectedKey, confidence };
}
