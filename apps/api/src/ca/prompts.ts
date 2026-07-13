/**
 * Structured-JSON schemas + system prompts for the re-engineered current-affairs
 * pipeline (see ./pipeline.ts). Built around exam relevance — every item is
 * TRIAGED (does it have a prelims life? a mains life?), and only surviving items
 * are ENRICHED, filling exactly the lives the triage found.
 *
 *   triageItem     (haiku) — score prelims_relevance + mains_relevance 0-3,
 *                            category, gs_papers, is_up_specific, syllabus nodes.
 *   enrichItem     (haiku) — bilingual title/summary + (conditionally)
 *                            prelims_facts and/or the full mains_brief +
 *                            possible_questions + per-node significance lines.
 *   generateMcqs   (haiku) — prelims practice MCQs (unchanged contract).
 *   generateMainsQuestion (sonnet) — ONE descriptive question for a mains-3 item.
 *
 * All classification/summarization runs on claude-haiku-4-5 (per CLAUDE.md's
 * model split); the single descriptive-question generation runs on sonnet.
 * ToS: the RSS title/snippet is only ever CONTEXT — every persisted string is a
 * fresh own-words paraphrase, never copied source text (enforced in the prompt).
 */
import { MODELS, structuredJson, type LlmUsage, type StructuredParams } from "../lib/anthropic.js";
import type {
  CurrentAffairsCategory,
  CurrentAffairsFact,
  CurrentAffairsGsPaper,
  CurrentAffairsMainsBrief,
  CurrentAffairsPossibleQuestions,
} from "@neev/shared";

const CATEGORIES: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "international_relations",
  "environment_ecology",
  "science_tech",
  "security",
  "social_issues",
  "art_culture",
  "schemes",
  "reports_indices",
  "places_persons",
  "up_special",
];

const GS_PAPERS: CurrentAffairsGsPaper[] = ["GS1", "GS2", "GS3", "GS4", "ESSAY", "GS5_UP", "GS6_UP"];

const FACT_KINDS: CurrentAffairsFact["kind"][] = [
  "scheme",
  "report_index",
  "place",
  "org",
  "species",
  "appointment",
  "day_theme",
  "misc",
];

const bilingual = {
  type: "object",
  additionalProperties: false,
  properties: { hi: { type: "string" }, en: { type: "string" } },
  required: ["hi", "en"],
} as const;

const bilingualList = {
  type: "object",
  additionalProperties: false,
  properties: {
    hi: { type: "array", items: { type: "string" } },
    en: { type: "array", items: { type: "string" } },
  },
  required: ["hi", "en"],
} as const;

export interface SyllabusCandidate {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Triage — the gate. Scores each item's two lives, categorizes, maps nodes.
// ---------------------------------------------------------------------------
export interface TriageResult {
  prelims_relevance: number; // 0-3
  mains_relevance: number; // 0-3
  prelims_reason: string;
  mains_reason: string;
  category: CurrentAffairsCategory;
  gs_papers: CurrentAffairsGsPaper[];
  is_up_specific: boolean;
  syllabus_node_ids: string[];
}

function clamp03(n: unknown): number {
  const v = typeof n === "number" ? Math.round(n) : 0;
  return Math.max(0, Math.min(3, v));
}

/** The StructuredParams for a triage call — shared by the sync path and the batch backfill. */
export function triageParams(opts: {
  title: string;
  snippet: string;
  sourceIsUp: boolean;
  candidates: SyllabusCandidate[];
}): StructuredParams {
  const candidateLines = opts.candidates.map((c) => `${c.id}: ${c.title}`).join("\n");
  return {
    model: MODELS.haiku,
    system:
      "You are a UPPSC (UP state civil services) exam strategist triaging a news item. Score its TWO independent " +
      "exam lives, each 0-3:\n" +
      "- prelims_relevance: does it carry a concrete, IDENTIFIABLE fact a prelims MCQ could test — a named scheme, " +
      "report/index (+rank), appointment, place/monument/river/park, organisation/institution, species, book/award, " +
      "day/theme, treaty, or a specific number/first/location? Prelims tests 'what/where/who' identification, so a " +
      "clearly NAMED entity in the news usually rates 2 EVEN IF the story's angle is analytical (e.g. a temple, an " +
      "organisation, a scheme, a report). 0 = no nameable fact (pure opinion/procedure/crime with no examable " +
      "entity); 1 = a fact too generic/ephemeral to test; 2 = a solid, testable named fact; 3 = a high-yield fact " +
      "very likely to be asked.\n" +
      "- mains_relevance: is it an ISSUE worth analysing in a descriptive answer (a policy debate, governance/economy/" +
      "IR/environment/ethics theme with arguments on multiple sides)? 0 = no analytical substance; 1 = thin; 2 = a " +
      "real issue with dimensions; 3 = a rich, debate-worthy issue central to the syllabus.\n" +
      "Be discriminating — routine crime, entertainment, personal-interest, and pure-procedure items score 0-1 on " +
      "BOTH and must be dropped. But MANY genuine current-affairs items carry BOTH a named prelims fact AND an " +
      "analytical mains angle — do not force a single life; score each honestly on its own merits.\n" +
      "Also return: `category` (one fixed value), `gs_papers` (which Mains GS papers the item feeds — [] if mains " +
      "isn't relevant; GS5_UP/GS6_UP are UP-specific papers), `is_up_specific` (true ONLY for items specifically " +
      "about Uttar Pradesh state government/policy/a UP event of state significance), and 0-3 `syllabus_node_ids` " +
      "chosen ONLY from the candidate list by id. Give a ONE-LINE justification for each relevance score.",
    content:
      `Title: ${opts.title}\n` +
      `Snippet: ${opts.snippet}\n` +
      `Source hints at Uttar Pradesh focus: ${opts.sourceIsUp}\n\n` +
      `Candidate syllabus nodes (id: title):\n${candidateLines}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prelims_relevance: { type: "integer" },
        mains_relevance: { type: "integer" },
        prelims_reason: { type: "string" },
        mains_reason: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        gs_papers: { type: "array", items: { type: "string", enum: GS_PAPERS } },
        is_up_specific: { type: "boolean" },
        syllabus_node_ids: { type: "array", items: { type: "string" } },
      },
      required: [
        "prelims_relevance",
        "mains_relevance",
        "prelims_reason",
        "mains_reason",
        "category",
        "gs_papers",
        "is_up_specific",
        "syllabus_node_ids",
      ],
    },
    maxTokens: 1200,
  };
}

/** Normalize/clamp a raw triage JSON against the candidate set. Shared by sync + batch paths. */
export function normalizeTriage(
  out: TriageResult,
  candidates: SyllabusCandidate[],
  sourceIsUp: boolean,
): TriageResult {
  const validIds = new Set(candidates.map((c) => c.id));
  return {
    ...out,
    prelims_relevance: clamp03(out.prelims_relevance),
    mains_relevance: clamp03(out.mains_relevance),
    gs_papers: [...new Set((out.gs_papers ?? []).filter((p) => GS_PAPERS.includes(p)))],
    is_up_specific: out.is_up_specific || sourceIsUp,
    syllabus_node_ids: (out.syllabus_node_ids ?? []).filter((id) => validIds.has(id)).slice(0, 3),
  };
}

export async function triageItem(opts: {
  title: string;
  snippet: string;
  sourceIsUp: boolean;
  candidates: SyllabusCandidate[];
  onUsage?: (u: LlmUsage) => void;
}): Promise<TriageResult> {
  const out = await structuredJson<TriageResult>({
    ...triageParams(opts),
    purpose: "ca_triage",
    onUsage: opts.onUsage,
  });
  return normalizeTriage(out, opts.candidates, opts.sourceIsUp);
}

// ---------------------------------------------------------------------------
// Enrichment — fills exactly the lives triage found. One call per surviving
// item: always title+summary; prelims_facts iff prelims life; mains_brief iff
// mains life; possible_questions + per-node significance accordingly.
// ---------------------------------------------------------------------------
interface BilingualPair {
  hi: string;
  en: string;
}

export interface NodeSignificanceRow {
  node_id: string;
  prelims_i18n: BilingualPair;
  mains_i18n: BilingualPair;
}

export interface EnrichResult {
  title_i18n: BilingualPair;
  summary_i18n: BilingualPair;
  prelims_facts: CurrentAffairsFact[];
  mains_brief: CurrentAffairsMainsBrief;
  possible_questions: CurrentAffairsPossibleQuestions;
  node_significance: NodeSignificanceRow[];
}

export interface EnrichParamsOpts {
  title: string;
  snippet: string;
  category: string;
  hasPrelimsLife: boolean;
  hasMainsLife: boolean;
  linkedNodes: SyllabusCandidate[];
}

/** The StructuredParams for an enrichment call — shared by the sync path and the batch backfill. */
export function enrichParams(opts: EnrichParamsOpts): StructuredParams {
  const lives = [
    opts.hasPrelimsLife ? "PRELIMS (fill prelims_facts + possible_questions.prelims_i18n)" : null,
    opts.hasMainsLife ? "MAINS (fill the full mains_brief + possible_questions.mains_i18n)" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const nodeLines = opts.linkedNodes.length
    ? opts.linkedNodes.map((n) => `${n.id}: ${n.title}`).join("\n")
    : "(none)";

  return {
    model: MODELS.haiku,
    system:
      "You write exam-oriented current-affairs material for UPPSC aspirants, in BOTH Hindi (Devanagari) and English. " +
      "ALWAYS write in your own words — never copy sentences verbatim from the source title/snippet (that text is " +
      "only context; copying it violates the source's copyright). Be concise, factual, neutral.\n" +
      "This item has these active exam lives: fill ONLY those; leave every field of an INACTIVE life empty " +
      "(empty string / empty array).\n" +
      "- title_i18n + summary_i18n: ALWAYS fill (a 1-2 sentence card summary).\n" +
      "- prelims_facts (prelims life): 3-6 boxed, standalone facts a student memorizes. Each has fact_i18n, a `kind` " +
      "(scheme/report_index/place/org/species/appointment/day_theme/misc), and `extras` (fill ministry/publisher/" +
      "rank/location ONLY when applicable, else omit the key). Prefer crisp who/what/when/how-much facts.\n" +
      "- mains_brief (mains life): why_in_news_i18n, background_i18n (1-2 lines), and these bilingual arrays (same " +
      "length + order across hi/en): significance_i18n (2-4 points), challenges_i18n (2-4), way_forward_i18n (2-4), " +
      "keywords_i18n (3-6 value-addition phrases/data points an examiner rewards), case_examples_i18n (1-3 concrete " +
      "examples/committees/data an answer can cite).\n" +
      "- possible_questions: a prelims MCQ-style stem (prelims life) and/or a mains directive-verb question (mains " +
      "life). Empty for an inactive life.\n" +
      "- node_significance: for EACH linked syllabus node given below, ONE line per active life explaining why this " +
      "item matters for that node in that exam (prelims_i18n / mains_i18n; empty for an inactive life). Echo the " +
      "node's id exactly.",
    content:
      `Active lives: ${lives || "none"}\n` +
      `Category: ${opts.category}\n` +
      `Title: ${opts.title}\n` +
      `Snippet: ${opts.snippet}\n\n` +
      `Linked syllabus nodes (id: title):\n${nodeLines}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title_i18n: bilingual,
        summary_i18n: bilingual,
        prelims_facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              fact_i18n: bilingual,
              kind: { type: "string", enum: FACT_KINDS },
              extras: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ministry: { type: "string" },
                  publisher: { type: "string" },
                  rank: { type: "string" },
                  location: { type: "string" },
                },
              },
            },
            required: ["fact_i18n", "kind", "extras"],
          },
        },
        mains_brief: {
          type: "object",
          additionalProperties: false,
          properties: {
            why_in_news_i18n: bilingual,
            background_i18n: bilingual,
            significance_i18n: bilingualList,
            challenges_i18n: bilingualList,
            way_forward_i18n: bilingualList,
            keywords_i18n: bilingualList,
            case_examples_i18n: bilingualList,
          },
          required: [
            "why_in_news_i18n",
            "background_i18n",
            "significance_i18n",
            "challenges_i18n",
            "way_forward_i18n",
            "keywords_i18n",
            "case_examples_i18n",
          ],
        },
        possible_questions: {
          type: "object",
          additionalProperties: false,
          properties: { prelims_i18n: bilingual, mains_i18n: bilingual },
          required: ["prelims_i18n", "mains_i18n"],
        },
        node_significance: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              node_id: { type: "string" },
              prelims_i18n: bilingual,
              mains_i18n: bilingual,
            },
            required: ["node_id", "prelims_i18n", "mains_i18n"],
          },
        },
      },
      required: [
        "title_i18n",
        "summary_i18n",
        "prelims_facts",
        "mains_brief",
        "possible_questions",
        "node_significance",
      ],
    },
    maxTokens: 6000,
  };
}

export async function enrichItem(opts: EnrichParamsOpts & { onUsage?: (u: LlmUsage) => void }): Promise<EnrichResult> {
  return structuredJson<EnrichResult>({
    ...enrichParams(opts),
    purpose: "ca_enrich",
    onUsage: opts.onUsage,
  });
}

// ---------------------------------------------------------------------------
// Prelims practice MCQs (unchanged contract — grounded on the item's facts).
// ---------------------------------------------------------------------------
export interface GeneratedMcq {
  stem_i18n: BilingualPair;
  options: { key: string; text_i18n: BilingualPair }[];
  correct_option_key: string;
  explanation_i18n: BilingualPair;
  difficulty: "easy" | "medium" | "hard";
}

export async function generateMcqs(opts: {
  title: string;
  facts: string[];
  onUsage?: (u: LlmUsage) => void;
}): Promise<GeneratedMcq[]> {
  const out = await structuredJson<{ questions: GeneratedMcq[] }>({
    model: MODELS.haiku,
    purpose: "ca_mcq_gen",
    onUsage: opts.onUsage,
    system:
      "You write UPPSC-prelims-style objective questions (bilingual, Hindi Devanagari + English) testing a " +
      "current-affairs item. Generate exactly 2 distinct questions, each with exactly 4 options keyed A/B/C/D, " +
      "exactly one correct, and a short explanation. Base questions ONLY on the facts given below — never invent " +
      "facts not present in them. Plain text only, no markdown.",
    content: `Title: ${opts.title}\nKey facts:\n${opts.facts.map((f) => `- ${f}`).join("\n")}`,
    schema: {
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
    },
    maxTokens: 4000,
  });
  return out.questions;
}

// ---------------------------------------------------------------------------
// Mains descriptive question (sonnet) — ONE per mains-3 item, grounded on the
// item's own mains_brief. Runs through the shared qgen critic before insert.
// ---------------------------------------------------------------------------
export interface GeneratedMainsQuestion {
  stem_i18n: BilingualPair;
  marks: number;
  word_limit: number;
  marking_points_i18n: { hi: string[]; en: string[] };
  difficulty: "easy" | "medium" | "hard";
}

export async function generateMainsQuestion(opts: {
  title: string;
  brief: CurrentAffairsMainsBrief;
  onUsage?: Parameters<typeof structuredJson>[0]["onUsage"];
}): Promise<GeneratedMainsQuestion> {
  const briefText = [
    `Why in news: ${opts.brief.why_in_news_i18n.en}`,
    `Background: ${opts.brief.background_i18n.en}`,
    `Significance: ${opts.brief.significance_i18n.en.join("; ")}`,
    `Challenges: ${opts.brief.challenges_i18n.en.join("; ")}`,
    `Way forward: ${opts.brief.way_forward_i18n.en.join("; ")}`,
  ].join("\n");

  const out = await structuredJson<GeneratedMainsQuestion>({
    model: MODELS.sonnet,
    effort: "medium",
    purpose: "ca_mains_gen",
    onUsage: opts.onUsage,
    system:
      "You are an experienced UPPSC Mains paper setter. Write ONE original, exam-standard DESCRIPTIVE (long-answer) " +
      "question, in BOTH Hindi (Devanagari) and English, on the current-affairs issue described below. Rules:\n" +
      "- Open with a real UPPSC directive verb (Examine / Critically analyse / Discuss / Evaluate / Comment / To " +
      "what extent / Elucidate) and demand analysis, not recall.\n" +
      "- Realistic UPPSC Mains marks + word limit (typically 125 words / 7 marks or 200 words / 10 marks).\n" +
      "- Provide a marking-points outline (4-7 crisp points a strong answer must cover) in BOTH languages, same " +
      "points same order. Ground every factual expectation in the brief or well-established knowledge; never " +
      "fabricate. Hindi and English must be faithful translations. Return strict JSON.",
    content: `Issue: ${opts.title}\n\n${briefText}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        stem_i18n: bilingual,
        marks: { type: "integer" },
        word_limit: { type: "integer" },
        marking_points_i18n: bilingualList,
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
      },
      required: ["stem_i18n", "marks", "word_limit", "marking_points_i18n", "difficulty"],
    },
    maxTokens: 3000,
  });
  return out;
}
