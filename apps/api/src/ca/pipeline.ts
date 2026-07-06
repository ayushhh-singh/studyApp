/**
 * Current-affairs ingestion pipeline. Fetches each configured RSS source
 * (./sources.ts), and per item: relevance-filters + classifies + maps
 * syllabus nodes, writes a bilingual exam-oriented summary, embeds it, and
 * (for "important" items) generates 2 unpublished practice MCQs.
 *
 * Idempotent across runs via `content_hash` (sha256 of the item's link) —
 * safe to run repeatedly (cron or `pnpm ca:run`) without duplicating items.
 *
 * Respects source ToS: only RSS metadata (title + short snippet) is ever
 * sent to the model as *context*; every persisted summary is a fresh
 * paraphrase (enforced by the prompt in ./prompts.ts), never copied source
 * text. We link back to the source, never mirror its article body.
 */
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import { i18nComplete } from "../ingest/_shared.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import { CA_SOURCES } from "./sources.js";
import {
  classifyItem,
  generateMcqs,
  summarizeItem,
  type SummarizeResult,
  type SyllabusCandidate,
} from "./prompts.js";

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

/** content_hash of every item inserted in the last 60 days — enough to dedupe any realistic re-run window. */
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
  important: number;
  mcqsGenerated: number;
  skippedDuplicate: number;
  skippedOld: number;
  skippedIrrelevant: number;
  skippedNoDate: number;
  cappedTotal: number;
  sourceFailures: { source: string; error: string }[];
}

interface EmbedTask {
  itemId: string;
  locale: "hi" | "en";
  text: string;
}

async function insertMcqsForItem(opts: {
  itemId: string;
  syllabusNodeId: string | null;
  title: string;
  summary: SummarizeResult;
}): Promise<string[]> {
  const mcqs = await generateMcqs({
    title: opts.title,
    summary: opts.summary.summary_i18n.en,
    whyItMatters: opts.summary.why_it_matters_i18n.en,
    keyFacts: opts.summary.key_facts_i18n.en,
  });
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
    // Always false — CA-generated MCQs are review-gated, never auto-published
    // regardless of bilingual completeness (unlike PYQ ingestion). They enter
    // the Review Queue as needs_review; approving one there publishes it
    // (migration 0035 / lib/question-visibility.ts).
    is_published: false,
    review_state: "needs_review" as const,
  }));

  const { data, error } = await supabase().from("questions").insert(rows).select("id");
  if (error) throw new Error(`CA mcq insert failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

export async function runPipeline(
  opts: PipelineOptions,
  log: (msg: string) => void = () => {},
): Promise<PipelineResult> {
  const parser = new Parser({ timeout: 20_000 });
  const result: PipelineResult = {
    processed: 0,
    published: 0,
    important: 0,
    mcqsGenerated: 0,
    skippedDuplicate: 0,
    skippedOld: 0,
    skippedIrrelevant: 0,
    skippedNoDate: 0,
    cappedTotal: 0,
    sourceFailures: [],
  };

  const candidates = await loadSyllabusCandidates();
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

      const classification = await classifyItem({
        title,
        snippet,
        sourceIsUp: source.isUpSource,
        candidates,
      });
      seenHashes.add(hash); // never re-fetch this link again, relevant or not
      takenFromSource++;

      if (!classification.is_relevant) {
        result.skippedIrrelevant++;
        continue;
      }

      const summary = await summarizeItem({ title, snippet, category: classification.category });
      const isPublished = i18nComplete(summary.title_i18n) && i18nComplete(summary.summary_i18n);

      const { data: row, error: insertError } = await supabase()
        .from("current_affairs_items")
        .insert({
          date: istDateString(pubDate),
          category: classification.category,
          is_up_specific: classification.is_up_specific || source.isUpSource,
          title_i18n: summary.title_i18n,
          summary_i18n: summary.summary_i18n,
          detail_i18n: {
            what_happened_i18n: summary.what_happened_i18n,
            why_it_matters_i18n: summary.why_it_matters_i18n,
            key_facts_i18n: summary.key_facts_i18n,
            question_angle_i18n: summary.question_angle_i18n,
          },
          source_urls: [link],
          syllabus_node_ids: classification.syllabus_node_ids,
          mcq_question_ids: [],
          is_published: isPublished,
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

      embedTasks.push({ itemId, locale: "hi", text: `${summary.title_i18n.hi}. ${summary.summary_i18n.hi}` });
      embedTasks.push({ itemId, locale: "en", text: `${summary.title_i18n.en}. ${summary.summary_i18n.en}` });

      let mcqIds: string[] = [];
      if (classification.is_important && isPublished) {
        result.important++;
        try {
          mcqIds = await insertMcqsForItem({
            itemId,
            syllabusNodeId: classification.syllabus_node_ids[0] ?? null,
            title,
            summary,
          });
          if (mcqIds.length > 0) {
            await supabase().from("current_affairs_items").update({ mcq_question_ids: mcqIds }).eq("id", itemId);
            result.mcqsGenerated += mcqIds.length;
          }
        } catch (err) {
          log(`[${source.id}] MCQ generation failed for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`);
        }
      }

      log(
        `[${source.id}] "${title.slice(0, 70)}" -> published=${isPublished} important=${classification.is_important} mcqs=${mcqIds.length}`,
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
