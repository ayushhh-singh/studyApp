/**
 * Embedding pre-filter for the current-affairs triage candidate list.
 *
 * WHY: triage is the highest-frequency LLM call in the codebase (one per RSS
 * item, every ca:run) and ~94% of its ~9.2k-token prompt is the ~260-node
 * syllabus candidate list, which is sent in full regardless of what the item
 * is actually about. This narrows that list to the K nodes most semantically
 * related to the item BEFORE the triage call, cutting measured triage input
 * cost by ~37% (234,373 -> 147,185 tokens over 24 items, replicated twice).
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not touch the triage prompt. The
 * instructions, scoring rules, `${id}: ${title}` line format, list header and
 * item-text-first ordering in ca/prompts.ts are untouched — see the long note
 * there on why that ordering is load-bearing. This changes only how many rows
 * go into `opts.candidates`.
 *
 * VALIDATION (2026-07-22): 3-arm design against a same-prompt control arm to
 * separate the change from haiku's substantial run-to-run nondeterminism, then
 * a blind 3-judge panel (provenance hidden, X/Y randomised) over every
 * disagreement. Relevance scoring was a dead tie (4-4 — drift is movement, not
 * degradation); node mapping favoured the shrunk list 11-6 (n=17, p~0.33, i.e.
 * a trend, NOT a significant improvement — the firm result is the ABSENCE of
 * regression); both gate-crossing cases went to the shrunk list. Recall of the
 * full-list run's own node choices was 95.7% at K=150, matching the 95.3%
 * predicted from 723 historical assignments.
 *
 * K IS A QUALITY DIAL, NOT A FREE COST KNOB. Recall degrades roughly in step
 * with the list: ~95% @150, ~87% @100, ~66% @40. Do not lower it for extra
 * savings without re-running the control-arm + blind-panel validation.
 */
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import { logger } from "../lib/logger.js";
import type { SyllabusCandidate } from "./prompts.js";

/** Nodes kept per item. See the K note above before changing this. */
export const PREFILTER_TOP_K = 150;

/** Below this many candidates there is nothing worth narrowing. */
const MIN_CANDIDATES_TO_FILTER = PREFILTER_TOP_K + 20;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? -1 : dot / denom;
}

function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Narrows the triage candidate list per item. Built once per run (the node
 * vectors are loaded once and reused), then `narrow()` is called per item.
 *
 * FAILS OPEN, ALWAYS: any problem — vectors missing, embed call throwing, too
 * few candidates — returns the FULL candidate list rather than a partial one.
 * A degraded pre-filter must never silently shrink the syllabus the model can
 * map to; the worst acceptable outcome is paying full price for a correct call.
 */
export class CandidatePrefilter {
  private constructor(
    private readonly candidates: SyllabusCandidate[],
    private readonly vectors: Map<string, number[]>,
    private readonly k: number,
  ) {}

  static async create(candidates: SyllabusCandidate[], k = PREFILTER_TOP_K): Promise<CandidatePrefilter> {
    const vectors = new Map<string, number[]>();
    try {
      // Chunked: an unranged/unchunked .in() over this many rows silently
      // truncates at PostgREST's 1000-row cap (a repeat offender in this repo).
      for (let i = 0; i < candidates.length; i += 40) {
        const batch = candidates.slice(i, i + 40).map((c) => c.id);
        const { data, error } = await supabase()
          .from("embeddings")
          .select("source_id, embedding")
          .eq("source_type", "syllabus")
          .eq("locale", "en")
          .in("source_id", batch)
          .range(0, 999);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          const vec = parseVector(row.embedding);
          if (vec) vectors.set(row.source_id as string, vec);
        }
      }
    } catch (err) {
      logger.warn({ err }, "ca prefilter: could not load syllabus vectors — triage will use the full candidate list");
      vectors.clear();
    }
    return new CandidatePrefilter(candidates, vectors, k);
  }

  /** True when we have enough coverage for narrowing to be safe. */
  get enabled(): boolean {
    return (
      this.candidates.length >= MIN_CANDIDATES_TO_FILTER &&
      this.vectors.size === this.candidates.length
    );
  }

  /** Top-k candidates for this item, or the full list on any doubt. */
  async narrow(title: string, snippet: string): Promise<SyllabusCandidate[]> {
    if (!this.enabled) return this.candidates;
    try {
      const [vec] = await embeddings().embed([`${title}\n${snippet}`.slice(0, 2000)]);
      if (!vec) return this.candidates;
      return this.candidates
        .map((c) => ({ c, score: cosine(vec, this.vectors.get(c.id)!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.k)
        .map((r) => r.c);
    } catch (err) {
      logger.warn({ err }, "ca prefilter: embed failed for item — falling back to the full candidate list");
      return this.candidates;
    }
  }
}
