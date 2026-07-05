/**
 * Structured-JSON schemas + system prompts for the current-affairs pipeline's
 * three LLM steps: classify (relevance/category/syllabus mapping), summarize
 * (bilingual exam-oriented breakdown), and generate (2 practice MCQs for
 * important items). All run on claude-haiku-4-5 (high-volume classification/
 * summarization, per CLAUDE.md's model split) via lib/anthropic.ts.
 */
import { MODELS, structuredJson } from "../lib/anthropic.js";
import type { CurrentAffairsCategory } from "@prayasup/shared";

const CATEGORIES: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "environment_ecology",
  "science_tech",
  "schemes_welfare",
  "up_state_affairs",
  "national",
  "international",
  "awards_sports_misc",
];

export interface SyllabusCandidate {
  id: string;
  title: string;
}

export interface ClassifyResult {
  is_relevant: boolean;
  is_up_specific: boolean;
  is_important: boolean;
  category: CurrentAffairsCategory;
  syllabus_node_ids: string[];
}

export async function classifyItem(opts: {
  title: string;
  snippet: string;
  sourceIsUp: boolean;
  candidates: SyllabusCandidate[];
}): Promise<ClassifyResult> {
  const candidateLines = opts.candidates.map((c) => `${c.id}: ${c.title}`).join("\n");
  const out = await structuredJson<ClassifyResult>({
    model: MODELS.haiku,
    purpose: "ca_classify",
    system:
      "You triage news items for a UPPSC (UP state civil services) exam-prep platform. " +
      "Decide if an item is relevant to the UPPSC prelims/mains syllabus (polity, economy, " +
      "geography, environment, science & tech, history, culture, government schemes, " +
      "Uttar Pradesh state affairs, national/international current events of exam value). " +
      "Ignore pure entertainment, celebrity, crime-blotter, or sports-result items unless " +
      "they carry a genuine schemes/awards/government angle. " +
      "`is_up_specific` = true only if the item is specifically about Uttar Pradesh state " +
      "government, UP policy, or a UP-located event of state significance. " +
      "`is_important` = true only for items substantial enough to be worth 2 practice MCQs " +
      "(a real policy, scheme, report, appointment, or event — not a routine update). " +
      "Pick 0-3 `syllabus_node_ids` ONLY from the provided candidate list, matching by id.",
    content:
      `Title: ${opts.title}\n` +
      `Snippet: ${opts.snippet}\n` +
      `Source hints at Uttar Pradesh focus: ${opts.sourceIsUp}\n\n` +
      `Candidate syllabus nodes (id: title):\n${candidateLines}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        is_relevant: { type: "boolean" },
        is_up_specific: { type: "boolean" },
        is_important: { type: "boolean" },
        category: { type: "string", enum: CATEGORIES },
        syllabus_node_ids: { type: "array", items: { type: "string" } },
      },
      required: ["is_relevant", "is_up_specific", "is_important", "category", "syllabus_node_ids"],
    },
    maxTokens: 1000,
  });
  const validIds = new Set(opts.candidates.map((c) => c.id));
  return { ...out, syllabus_node_ids: out.syllabus_node_ids.filter((id) => validIds.has(id)).slice(0, 3) };
}

interface BilingualPair {
  hi: string;
  en: string;
}

export interface SummarizeResult {
  title_i18n: BilingualPair;
  summary_i18n: BilingualPair;
  what_happened_i18n: BilingualPair;
  why_it_matters_i18n: BilingualPair;
  key_facts_i18n: { hi: string[]; en: string[] };
  question_angle_i18n: BilingualPair;
}

const bilingual = { type: "object", additionalProperties: false, properties: { hi: { type: "string" }, en: { type: "string" } }, required: ["hi", "en"] };

export async function summarizeItem(opts: {
  title: string;
  snippet: string;
  category: string;
}): Promise<SummarizeResult> {
  return structuredJson<SummarizeResult>({
    model: MODELS.haiku,
    purpose: "ca_summarize",
    system:
      "You write exam-oriented current-affairs briefs for UPPSC aspirants, in BOTH Hindi " +
      "(Devanagari) and English. ALWAYS write in your own words — never copy sentences " +
      "verbatim from the source title/snippet given to you (that text is only context; " +
      "copying it would violate the source's copyright). Be concise, factual, and neutral. " +
      "`key_facts_i18n` must be 3-5 short standalone bullet facts (each locale's array the " +
      "same length, same order, translations of each other) a student should memorize. " +
      "`question_angle_i18n` is one sentence suggesting how a UPPSC prelims/mains question " +
      "could be framed around this item.",
    content: `Category: ${opts.category}\nTitle: ${opts.title}\nSnippet: ${opts.snippet}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title_i18n: bilingual,
        summary_i18n: bilingual,
        what_happened_i18n: bilingual,
        why_it_matters_i18n: bilingual,
        key_facts_i18n: {
          type: "object",
          additionalProperties: false,
          properties: {
            hi: { type: "array", items: { type: "string" } },
            en: { type: "array", items: { type: "string" } },
          },
          required: ["hi", "en"],
        },
        question_angle_i18n: bilingual,
      },
      required: [
        "title_i18n",
        "summary_i18n",
        "what_happened_i18n",
        "why_it_matters_i18n",
        "key_facts_i18n",
        "question_angle_i18n",
      ],
    },
    maxTokens: 4000,
  });
}

export interface GeneratedMcq {
  stem_i18n: BilingualPair;
  options: { key: string; text_i18n: BilingualPair }[];
  correct_option_key: string;
  explanation_i18n: BilingualPair;
  difficulty: "easy" | "medium" | "hard";
}

export async function generateMcqs(opts: {
  title: string;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
}): Promise<GeneratedMcq[]> {
  const out = await structuredJson<{ questions: GeneratedMcq[] }>({
    model: MODELS.haiku,
    purpose: "ca_mcq_gen",
    system:
      "You write UPPSC-prelims-style objective questions (bilingual, Hindi Devanagari + " +
      "English) testing a current-affairs item. Generate exactly 2 distinct questions, each " +
      "with exactly 4 options keyed A/B/C/D, exactly one correct, and a short explanation. " +
      "Base questions ONLY on the facts given below — never invent facts not present in them.",
    content:
      `Title: ${opts.title}\nSummary: ${opts.summary}\nWhy it matters: ${opts.whyItMatters}\n` +
      `Key facts:\n${opts.keyFacts.map((f) => `- ${f}`).join("\n")}`,
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
