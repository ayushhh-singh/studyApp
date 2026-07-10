/**
 * Current-affairs ingestion pipeline, re-engineered around EXAM RELEVANCE.
 *
 * Per item (idempotent across runs via `content_hash` = sha256 of the link):
 *   1. TRIAGE (haiku) — score prelims_relevance + mains_relevance (0-3),
 *      category, gs_papers, is_up_specific, syllabus nodes.
 *   2. HARD GATE — max(prelims, mains) < 2 → store as status='archived' and
 *      STOP (no further LLM spend). This is the "too broad" fix, in code.
 *   3. ENRICH (haiku) — one call filling exactly the lives triage found:
 *      prelims_facts (prelims life) and/or the full mains_brief (mains life),
 *      plus possible_questions + per-node significance lines.
 *   4. Bilingual publish gate (title + summary present in both languages) →
 *      status='published', else 'draft'. Embed published items.
 *   5. DUAL QUIZ — prelims_relevance >= 2 → 2 practice MCQs (review-gated);
 *      mains_relevance === 3 → ONE descriptive question (sonnet + critic),
 *      tagged ca_linked, into the descriptive pool (review-gated).
 *
 * ToS: only the RSS title + short snippet is ever sent to the model as CONTEXT;
 * every persisted string is a fresh own-words paraphrase (enforced in prompts).
 */
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import { i18nComplete } from "../ingest/_shared.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import type { LlmUsage } from "../lib/anthropic.js";
import { structuredJson } from "../lib/anthropic.js";
import { MODELS } from "../lib/models.js";
import { buildCriticParams, parseCritic, QGEN_PROMPT_VERSION } from "../qgen/prompts.js";
import type {
  CurrentAffairsFact,
  CurrentAffairsMainsBrief,
  CurrentAffairsNodeSignificance,
  CurrentAffairsPossibleQuestions,
} from "@prayasup/shared";
import { CA_SOURCES } from "./sources.js";
import {
  enrichItem,
  generateMainsQuestion,
  generateMcqs,
  triageItem,
  type EnrichResult,
  type SyllabusCandidate,
} from "./prompts.js";

/** Items scoring below this on BOTH lives are archived (the hard gate). */
export const RELEVANCE_GATE = 2;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

interface BilingualPair {
  hi: string;
  en: string;
}

/** A bilingual pair with nothing in either language → null. */
function nullIfEmpty(pair: BilingualPair | null | undefined): BilingualPair | null {
  if (!pair) return null;
  return pair.hi.trim() || pair.en.trim() ? pair : null;
}

async function loadSyllabusCandidates(): Promise<SyllabusCandidate[]> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, title_i18n")
    .gte("depth", 1)
    .lte("depth", 2)
    .order("paper_code", { ascending: true })
    .limit(260);
  if (error) throw new Error(`syllabus candidates query failed: ${error.message}`);
  return (data ?? []).map((n) => ({
    id: n.id as string,
    title: ((n.title_i18n as { en?: string }).en ?? "").trim(),
  }));
}

/** content_hash of every item seen in the last 60 days — dedupe any realistic re-run window. */
async function loadRecentHashes(): Promise<Set<string>> {
  const cutoff = istDateString(new Date(Date.now() - 60 * 24 * 3600 * 1000));
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("content_hash")
    .gte("date", cutoff)
    .not("content_hash", "is", null);
  if (error) throw new Error(`recent hashes query failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.content_hash as string));
}

export interface PipelineOptions {
  days: number;
  maxPerSource: number;
  maxTotal: number;
}

export interface PipelineResult {
  processed: number;
  published: number;
  draft: number;
  archived: number;
  prelimsLife: number;
  mainsLife: number;
  dualLife: number;
  mcqsGenerated: number;
  mainsQuestionsGenerated: number;
  skippedDuplicate: number;
  skippedOld: number;
  skippedNoDate: number;
  cappedTotal: number;
  costUsd: number;
  sourceFailures: { source: string; error: string }[];
}

interface EmbedTask {
  itemId: string;
  locale: "hi" | "en";
  text: string;
}

/** Build the node_significance record, keeping only lines for the item's active lives. */
function buildNodeSignificance(
  enrich: EnrichResult,
  hasPrelims: boolean,
  hasMains: boolean,
): CurrentAffairsNodeSignificance | null {
  const record: CurrentAffairsNodeSignificance = {};
  for (const row of enrich.node_significance ?? []) {
    const prelims = hasPrelims ? nullIfEmpty(row.prelims_i18n) : null;
    const mains = hasMains ? nullIfEmpty(row.mains_i18n) : null;
    if (prelims || mains) record[row.node_id] = { prelims_i18n: prelims, mains_i18n: mains };
  }
  return Object.keys(record).length > 0 ? record : null;
}

async function insertMcqsForItem(opts: {
  syllabusNodeId: string | null;
  title: string;
  facts: string[];
  onUsage: (u: LlmUsage) => void;
}): Promise<string[]> {
  const mcqs = await generateMcqs({ title: opts.title, facts: opts.facts });
  if (mcqs.length === 0) return [];

  const rows = mcqs.map((q) => ({
    type: "mcq" as const,
    stage: "prelims" as const,
    paper_code: CURRENT_AFFAIRS_PAPER_CODE,
    syllabus_node_id: opts.syllabusNodeId,
    year: null,
    source: "generated" as const,
    stem_i18n: q.stem_i18n,
    options_i18n: q.options.map((o) => ({ key: o.key, text_i18n: o.text_i18n })),
    correct_option_key: q.correct_option_key,
    explanation_i18n: q.explanation_i18n,
    difficulty: q.difficulty,
    word_limit: null,
    marks: 2,
    // Always review-gated (needs_review, is_published=false) — approving one in
    // the Review Queue publishes it (see lib/question-visibility.ts).
    is_published: false,
    review_state: "needs_review" as const,
  }));

  const { data, error } = await supabase().from("questions").insert(rows).select("id");
  if (error) throw new Error(`CA mcq insert failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Generate ONE descriptive question for a mains-3 item, grounded on its brief,
 * run it through the shared qgen critic, and insert it (review-gated,
 * tagged ca_linked) if the critic approves. Returns the question id or null.
 */
async function insertMainsQuestionForItem(opts: {
  itemId: string;
  syllabusNodeId: string | null;
  title: string;
  brief: CurrentAffairsMainsBrief;
  onUsage: (u: LlmUsage) => void;
}): Promise<string | null> {
  const q = await generateMainsQuestion({ title: opts.title, brief: opts.brief, onUsage: opts.onUsage });

  // Session-11 qgen critic gate — reject anything not exam-worthy.
  const criticJson = await structuredJson({
    ...buildCriticParams({
      node: {
        id: opts.syllabusNodeId ?? "",
        paperCode: CURRENT_AFFAIRS_PAPER_CODE,
        stage: "mains",
        title_i18n: { hi: "", en: opts.title },
        description_i18n: null,
      },
      rendered:
        `Type: Descriptive (Mains)\nQuestion: ${q.stem_i18n.en}\nMarks: ${q.marks} | Word limit: ${q.word_limit}\n` +
        `Marking points:\n${q.marking_points_i18n.en.map((p) => `  - ${p}`).join("\n")}`,
      // CA mains questions aren't node-RAG-grounded; the critic reads the brief
      // it was written from. Pass empty grounding (buildCriticParams handles it).
      grounding: { chunks: [], nodeChunkCount: 0 },
    }),
    purpose: "ca_mains_critic",
    onUsage: opts.onUsage,
  });
  const critic = parseCritic(criticJson);
  if (!critic.approve) return null;

  const { data, error } = await supabase()
    .from("questions")
    .insert({
      type: "descriptive",
      stage: "mains",
      paper_code: CURRENT_AFFAIRS_PAPER_CODE,
      syllabus_node_id: opts.syllabusNodeId,
      year: null,
      source: "generated",
      stem_i18n: q.stem_i18n,
      options_i18n: null,
      correct_option_key: null,
      explanation_i18n: null,
      difficulty: q.difficulty,
      word_limit: q.word_limit,
      marks: q.marks,
      is_published: false,
      review_state: "needs_review",
      generation_meta: {
        ca_linked: true,
        source_item_id: opts.itemId,
        model: MODELS.sonnet,
        prompt_version: QGEN_PROMPT_VERSION,
        marking_points_i18n: q.marking_points_i18n,
        critic,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`CA mains question insert failed: ${error.message}`);
  return data.id as string;
}

export async function runPipeline(
  opts: PipelineOptions,
  log: (msg: string) => void = () => {},
): Promise<PipelineResult> {
  const parser = new Parser({ timeout: 20_000 });
  const result: PipelineResult = {
    processed: 0,
    published: 0,
    draft: 0,
    archived: 0,
    prelimsLife: 0,
    mainsLife: 0,
    dualLife: 0,
    mcqsGenerated: 0,
    mainsQuestionsGenerated: 0,
    skippedDuplicate: 0,
    skippedOld: 0,
    skippedNoDate: 0,
    cappedTotal: 0,
    costUsd: 0,
    sourceFailures: [],
  };
  const onUsage = (u: LlmUsage) => (result.costUsd += u.costUsd);

  const candidates = await loadSyllabusCandidates();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  log(`syllabus candidates for mapping: ${candidates.length}`);
  const seenHashes = await loadRecentHashes();
  log(`known items in the last 60 days: ${seenHashes.size}`);

  const embedTasks: EmbedTask[] = [];

  for (const source of CA_SOURCES) {
    if (result.processed >= opts.maxTotal) {
      result.cappedTotal++;
      continue;
    }
    let feed;
    try {
      feed = await parser.parseURL(source.feedUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.sourceFailures.push({ source: source.id, error: message });
      log(`[${source.id}] FEED FETCH FAILED: ${message}`);
      continue;
    }

    let takenFromSource = 0;
    for (const item of feed.items ?? []) {
      if (result.processed >= opts.maxTotal) {
        result.cappedTotal++;
        break;
      }
      if (takenFromSource >= opts.maxPerSource) break;

      const link = item.link ?? item.guid;
      const title = (item.title ?? "").trim();
      if (!link || !title) continue;

      const hash = sha256(link);
      if (seenHashes.has(hash)) {
        result.skippedDuplicate++;
        continue;
      }

      const rawDate = item.isoDate ?? item.pubDate;
      const pubDate = rawDate ? new Date(rawDate) : null;
      if (!pubDate || Number.isNaN(pubDate.getTime())) {
        result.skippedNoDate++;
        continue;
      }
      const ageDays = (Date.now() - pubDate.getTime()) / (24 * 3600 * 1000);
      if (ageDays > opts.days) {
        result.skippedOld++;
        continue;
      }

      const snippet = (item.contentSnippet ?? item.content ?? "").slice(0, 1200);
      const dateStr = istDateString(pubDate);

      // --- 1. Triage --------------------------------------------------------
      const triage = await triageItem({ title, snippet, sourceIsUp: source.isUpSource, candidates, onUsage });
      seenHashes.add(hash); // never re-triage this link again, kept or archived
      takenFromSource++;

      const bestScore = Math.max(triage.prelims_relevance, triage.mains_relevance);
      const hasPrelims = triage.prelims_relevance >= RELEVANCE_GATE;
      const hasMains = triage.mains_relevance >= RELEVANCE_GATE;

      // --- 2. Hard gate -----------------------------------------------------
      if (bestScore < RELEVANCE_GATE) {
        await supabase()
          .from("current_affairs_items")
          .insert({
            date: dateStr,
            status: "archived",
            category: triage.category,
            is_up_specific: triage.is_up_specific,
            prelims_relevance: triage.prelims_relevance,
            mains_relevance: triage.mains_relevance,
            gs_papers: triage.gs_papers,
            title_i18n: { hi: "", en: title },
            syllabus_node_ids: triage.syllabus_node_ids,
            mcq_question_ids: [],
            content_hash: hash,
            source_id: source.id,
            source_urls: [link],
          });
        result.archived++;
        log(
          `[${source.id}] ARCHIVED (P${triage.prelims_relevance}/M${triage.mains_relevance}) "${title.slice(0, 64)}" — ${triage.prelims_reason} | ${triage.mains_reason}`,
        );
        continue;
      }

      // --- 3. Enrich (only the active lives) --------------------------------
      const linkedNodes = triage.syllabus_node_ids
        .map((id) => candidateById.get(id))
        .filter((n): n is SyllabusCandidate => !!n);
      const enrich = await enrichItem({
        title,
        snippet,
        category: triage.category,
        hasPrelimsLife: hasPrelims,
        hasMainsLife: hasMains,
        linkedNodes,
        onUsage,
      });

      const prelimsFacts: CurrentAffairsFact[] | null =
        hasPrelims && enrich.prelims_facts.length > 0 ? enrich.prelims_facts : null;
      const mainsBrief: CurrentAffairsMainsBrief | null =
        hasMains && enrich.mains_brief.why_in_news_i18n.en.trim() ? enrich.mains_brief : null;
      const possibleQuestions: CurrentAffairsPossibleQuestions = {
        prelims_i18n: hasPrelims ? nullIfEmpty(enrich.possible_questions.prelims_i18n) : null,
        mains_i18n: hasMains ? nullIfEmpty(enrich.possible_questions.mains_i18n) : null,
      };
      const nodeSignificance = buildNodeSignificance(enrich, hasPrelims, hasMains);

      // --- 4. Publish gate + insert -----------------------------------------
      const isPublished = i18nComplete(enrich.title_i18n) && i18nComplete(enrich.summary_i18n);
      const status = isPublished ? "published" : "draft";

      const { data: row, error: insertError } = await supabase()
        .from("current_affairs_items")
        .insert({
          date: dateStr,
          status,
          category: triage.category,
          is_up_specific: triage.is_up_specific,
          prelims_relevance: triage.prelims_relevance,
          mains_relevance: triage.mains_relevance,
          gs_papers: triage.gs_papers,
          title_i18n: enrich.title_i18n,
          summary_i18n: enrich.summary_i18n,
          prelims_facts: prelimsFacts,
          mains_brief: mainsBrief,
          possible_questions: possibleQuestions,
          node_significance: nodeSignificance,
          source_urls: [link],
          syllabus_node_ids: triage.syllabus_node_ids,
          mcq_question_ids: [],
          content_hash: hash,
          source_id: source.id,
        })
        .select("id")
        .single();
      if (insertError) {
        log(`[${source.id}] INSERT FAILED for "${title.slice(0, 60)}": ${insertError.message}`);
        continue;
      }

      const itemId = row.id as string;
      result.processed++;
      if (isPublished) result.published++;
      else result.draft++;
      if (hasPrelims) result.prelimsLife++;
      if (hasMains) result.mainsLife++;
      if (hasPrelims && hasMains) result.dualLife++;

      if (isPublished) {
        embedTasks.push({ itemId, locale: "hi", text: `${enrich.title_i18n.hi}. ${enrich.summary_i18n.hi}` });
        embedTasks.push({ itemId, locale: "en", text: `${enrich.title_i18n.en}. ${enrich.summary_i18n.en}` });
      }

      // --- 5. Dual quiz generation ------------------------------------------
      const nodeId = triage.syllabus_node_ids[0] ?? null;

      // Prelims MCQs — a real factual nugget (prelims_relevance >= 2), published.
      if (hasPrelims && isPublished && prelimsFacts) {
        try {
          const mcqIds = await insertMcqsForItem({
            syllabusNodeId: nodeId,
            title: enrich.title_i18n.en,
            facts: prelimsFacts.map((f) => f.fact_i18n.en),
            onUsage,
          });
          if (mcqIds.length > 0) {
            await supabase().from("current_affairs_items").update({ mcq_question_ids: mcqIds }).eq("id", itemId);
            result.mcqsGenerated += mcqIds.length;
          }
        } catch (err) {
          log(`[${source.id}] MCQ generation failed for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`);
        }
      }

      // Mains descriptive question — only the richest issues (mains_relevance === 3).
      let mainsQId: string | null = null;
      if (triage.mains_relevance === 3 && isPublished && mainsBrief) {
        try {
          mainsQId = await insertMainsQuestionForItem({
            itemId,
            syllabusNodeId: nodeId,
            title: enrich.title_i18n.en,
            brief: mainsBrief,
            onUsage,
          });
          if (mainsQId) result.mainsQuestionsGenerated++;
        } catch (err) {
          log(`[${source.id}] Mains question generation failed for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`);
        }
      }

      log(
        `[${source.id}] KEPT (P${triage.prelims_relevance}/M${triage.mains_relevance}) status=${status} ` +
          `lives=${[hasPrelims ? "prelims" : null, hasMains ? "mains" : null].filter(Boolean).join("+") || "none"} ` +
          `mains_q=${mainsQId ? "yes" : "no"} "${enrich.title_i18n.en.slice(0, 56)}"`,
      );
    }
  }

  if (embedTasks.length > 0) {
    const provider = embeddings();
    const batchSize = 96;
    for (let i = 0; i < embedTasks.length; i += batchSize) {
      const batch = embedTasks.slice(i, i + batchSize);
      const vectors = await provider.embed(batch.map((t) => t.text));
      const rows = batch.map((t, j) => ({
        source_type: "current_affairs" as const,
        source_id: t.itemId,
        locale: t.locale,
        chunk_text: t.text,
        embedding: toVectorLiteral(vectors[j]),
      }));
      const { error } = await supabase()
        .from("embeddings")
        .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
      if (error) log(`embeddings upsert failed for batch starting ${i}: ${error.message}`);
    }
    log(`embedded ${embedTasks.length} chunks`);
  }

  return result;
}
