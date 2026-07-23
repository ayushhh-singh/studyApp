/**
 * RAG grounding for answer evaluation.
 *
 * Before the examiner model scores an answer, we retrieve the syllabus/PYQ
 * chunks most relevant to the *question* from the pgvector `embeddings` store,
 * so content judgments are anchored to the real UPPSC syllabus rather than the
 * model's unaided recall. Retrieval is by cosine similarity against an embedding
 * of the question text (see supabase/migrations/0027_match_embeddings.sql).
 *
 * When the question is catalogued and mapped to a syllabus node, that node's own
 * chunks are pulled first (authoritative for the topic) and merged ahead of the
 * broader semantic hits. Everything degrades gracefully: if embedding or the RPC
 * fails, or the store is empty, grounding returns empty and the evaluation
 * proceeds ungrounded (the prompt is told so explicitly).
 */
import type { Locale } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { embeddings } from "../../lib/embeddings.js";
import { logger } from "../../lib/logger.js";

export interface GroundingChunk {
  source_type: string;
  source_id: string;
  chunk_text: string;
  similarity: number;
}

export interface GroundingResult {
  chunks: GroundingChunk[];
  /** How many of the chunks came from the question's own syllabus node. */
  nodeChunkCount: number;
}

interface MatchRow {
  id: string;
  source_type: string;
  source_id: string;
  locale: string;
  chunk_text: string;
  similarity: number;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function match(params: {
  queryEmbedding: string;
  matchCount: number;
  locale: Locale;
  sourceType?: string;
  sourceId?: string;
}): Promise<MatchRow[]> {
  const { data, error } = await supabase().rpc("match_embeddings", {
    query_embedding: params.queryEmbedding,
    match_count: params.matchCount,
    filter_locale: params.locale,
    filter_source_type: params.sourceType ?? null,
    filter_source_id: params.sourceId ?? null,
  });
  if (error) throw new Error(`match_embeddings failed: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

/**
 * Retrieve up to `k` reference chunks for the question, in the answer's locale.
 * Node-scoped chunks (if any) rank first; the rest are the top global semantic
 * hits, de-duplicated by chunk id.
 */
export async function retrieveGrounding(opts: {
  questionText: string;
  locale: Locale;
  syllabusNodeId: string | null;
  k?: number;
  /**
   * Precomputed embedding for `questionText`, skipping the internal embed()
   * call — for a caller that has already batched this query alongside others
   * in one pooled embed request (e.g. qgen's nightly top-up across many nodes).
   * Must be the embedding of `questionText` itself; omit to embed it here.
   */
  queryEmbedding?: number[];
}): Promise<GroundingResult> {
  const k = opts.k ?? 8;
  const query = opts.questionText.replace(/\s+/g, " ").trim();
  if (!query) return { chunks: [], nodeChunkCount: 0 };

  try {
    const vec = opts.queryEmbedding ?? (await embeddings().embed([query]))[0];
    if (!vec) return { chunks: [], nodeChunkCount: 0 };
    const literal = toVectorLiteral(vec);

    const nodeRows = opts.syllabusNodeId
      ? await match({
          queryEmbedding: literal,
          matchCount: k,
          locale: opts.locale,
          sourceType: "syllabus",
          sourceId: opts.syllabusNodeId,
        })
      : [];

    const globalRows = await match({ queryEmbedding: literal, matchCount: k, locale: opts.locale });

    const seen = new Set<string>();
    const merged: MatchRow[] = [];
    for (const row of [...nodeRows, ...globalRows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= k) break;
    }

    const nodeIds = new Set(nodeRows.map((r) => r.id));
    return {
      chunks: merged.map((r) => ({
        source_type: r.source_type,
        source_id: r.source_id,
        chunk_text: r.chunk_text,
        similarity: r.similarity,
      })),
      nodeChunkCount: merged.filter((r) => nodeIds.has(r.id)).length,
    };
  } catch (err) {
    // Grounding is best-effort — never fail the whole evaluation over retrieval.
    logger.warn({ err }, "RAG grounding failed; evaluating ungrounded");
    return { chunks: [], nodeChunkCount: 0 };
  }
}
