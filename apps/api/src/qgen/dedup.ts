/**
 * Stage D — near-duplicate detection. Embeds each candidate stem and compares
 * (cosine) against (a) the node's existing question bank and (b) the other
 * candidates in this run. A candidate whose best match is at/above
 * DEDUP_THRESHOLD is rejected as a duplicate; every candidate keeps its nearest
 * existing hits so the Review Queue can show the reviewer what it resembles.
 *
 * Scoped per node (the only place a duplicate can realistically arise, and
 * bounded — nodes that need top-up have few existing questions). Degrades
 * gracefully: on any embedding error, nothing is flagged as a duplicate (the
 * critic/verify stages remain the real quality gate).
 */
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import { logger } from "../lib/logger.js";

/** Cosine at/above which two stems are treated as the same question. */
export const DEDUP_THRESHOLD = 0.9;

export interface DedupHit {
  question_id: string;
  similarity: number;
}

export interface DedupResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  /** Nearest EXISTING questions (highest cosine first, up to 3). */
  nearest: DedupHit[];
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function embedAll(texts: string[]): Promise<number[][]> {
  const provider = embeddings();
  const out: number[][] = [];
  const batchSize = 96;
  for (let i = 0; i < texts.length; i += batchSize) {
    const vecs = await provider.embed(texts.slice(i, i + batchSize));
    for (const v of vecs) out.push(normalize(v));
  }
  return out;
}

export async function dedupCandidates(nodeId: string | null, candidateStems: string[]): Promise<DedupResult[]> {
  const clean = candidateStems.map((s) => s.replace(/\s+/g, " ").trim());
  const empty = (): DedupResult[] => clean.map(() => ({ isDuplicate: false, maxSimilarity: 0, nearest: [] }));
  if (clean.length === 0) return [];

  try {
    // Existing bank for this node (any review_state — avoid regenerating a
    // near-dupe of something already pending review, too).
    let existingIds: string[] = [];
    let existingTexts: string[] = [];
    if (nodeId) {
      const { data, error } = await supabase()
        .from("questions")
        .select("id, stem_i18n")
        .eq("syllabus_node_id", nodeId)
        .limit(500);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const stem = r.stem_i18n as { en?: string; hi?: string };
        const text = (stem.en || stem.hi || "").replace(/\s+/g, " ").trim();
        if (text) {
          existingIds.push(r.id as string);
          existingTexts.push(text);
        }
      }
    }

    const candidateVecs = await embedAll(clean);
    const existingVecs = existingTexts.length ? await embedAll(existingTexts) : [];

    return clean.map((_, i) => {
      const cand = candidateVecs[i];
      // vs existing bank
      const hits: DedupHit[] = existingVecs
        .map((v, j) => ({ question_id: existingIds[j], similarity: dot(cand, v) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
      const maxExisting = hits[0]?.similarity ?? 0;
      // vs earlier candidates in this run (keep the first of any near-dup pair)
      let maxRun = 0;
      for (let j = 0; j < i; j++) maxRun = Math.max(maxRun, dot(cand, candidateVecs[j]));
      const maxSimilarity = Math.max(maxExisting, maxRun);
      return { isDuplicate: maxSimilarity >= DEDUP_THRESHOLD, maxSimilarity, nearest: hits };
    });
  } catch (err) {
    logger.warn({ err, nodeId }, "qgen dedup failed; treating all candidates as unique");
    return empty();
  }
}
