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

/**
 * Cosine at/above which two stems are treated as the same question.
 *
 * ⚑ PER KIND, AND THE DESCRIPTIVE VALUE IS MEASURED, NOT CHOSEN. The reference
 * population is real PYQ pairs sitting on the SAME syllabus node: the commission
 * set both, so they are distinct BY CONSTRUCTION, and no gate should ever reject
 * a pair that resembles each other less than those do. Measured 2026-08-13 over
 * 12 nodes per kind:
 *
 *   real same-node DESCRIPTIVE pairs (n=431): median 0.359, p99 0.754, max 0.835
 *   real same-node MCQ pairs        (n=540): median 0.288, p99 0.612, max 0.645
 *
 * So 0.9 sat far above anything real, and three generated GS4 questions restating
 * one textbook trichotomy measured 0.847 / 0.875 / 0.880 — all admitted as
 * "distinct". A generated GS3 question also near-duplicated an EXISTING real PYQ
 * at 0.842 and passed. 0.84 sits just above the real descriptive maximum, so it
 * catches every one of those while remaining incapable of rejecting a pair as
 * dissimilar as the most-similar real pair.
 *
 * ⚑ MCQ DELIBERATELY STAYS AT 0.9 even though its real max is far lower, and
 * lowering it would be a BUG rather than a tightening: this stage embeds the STEM
 * ONLY, and a match-list MCQ's stem is boilerplate — the content lives in the
 * options. Two real published PYQs share the exact stem "Which one of the
 * following is not correctly matched?" (cosine 1.0) while being entirely
 * different questions, so any threshold that would tighten MCQ would reject them.
 * The real MCQ fix is to embed stem+options; until then a permissive threshold is
 * the safe failure direction. Recorded in `docs/OUTSTANDING.md` §9.
 */
export const DEDUP_THRESHOLD_BY_KIND = { mcq: 0.9, descriptive: 0.84 } as const;
/** Back-compat alias — the MCQ value, which is the historical global threshold. */
export const DEDUP_THRESHOLD = DEDUP_THRESHOLD_BY_KIND.mcq;

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
    // OpenAI rejects empty-string inputs with a 400 — one broken/empty stem
    // would otherwise fail the whole batch and silently disable dedup for the
    // node. Substitute a placeholder (a stem this empty is a non-publishable
    // question anyway; its embedding just won't match anything).
    const vecs = await provider.embed(texts.slice(i, i + batchSize).map((t) => t || "(empty question)"));
    for (const v of vecs) out.push(normalize(v));
  }
  return out;
}

/**
 * @param kind REQUIRED — the two kinds have measurably different similarity
 *   distributions (see `DEDUP_THRESHOLD_BY_KIND`), and a defaulted trailing
 *   parameter is how a caller silently keeps the old behaviour (this repo's M24
 *   lesson). Making it required forces every call site to state which it is.
 */
export async function dedupCandidates(
  nodeId: string | null,
  candidateStems: string[],
  kind: keyof typeof DEDUP_THRESHOLD_BY_KIND,
): Promise<DedupResult[]> {
  const threshold = DEDUP_THRESHOLD_BY_KIND[kind];
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
      return { isDuplicate: maxSimilarity >= threshold, maxSimilarity, nearest: hits };
    });
  } catch (err) {
    logger.warn({ err, nodeId }, "qgen dedup failed; treating all candidates as unique");
    return empty();
  }
}
