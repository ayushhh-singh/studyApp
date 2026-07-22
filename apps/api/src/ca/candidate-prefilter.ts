/**
 * Embedding pre-filter for the current-affairs triage candidate list.
 *
 * WHY: triage is the highest-frequency LLM call in the codebase (one per RSS
 * item, every ca:run) and ~94% of its ~9.2k-token prompt is the ~284-node
 * syllabus candidate list, which is sent in full regardless of what the item
 * is actually about. This narrows that list to the K nodes most semantically
 * related to the item BEFORE the triage call, cutting measured triage input
 * cost by ~42% for Latin-script items (262,176 -> 152,543 tokens over 25 items
 * on the real 284-node tree) and ~19% for Devanagari ones (which use a wider K).
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
 * disagreement. That first panel ran against a TRUNCATED 260-node candidate
 * set (see the re-validation below) and suggested node mapping favoured the
 * shrunk list 11-6 — flagged at the time as a trend, not a significant result.
 *
 * RE-VALIDATED 2026-07-23 on the corrected 284-node tree, same 3-arm + blind
 * 3-judge design, 25 Latin-script items: relevance A=2 / C=2 / tie=1 against a
 * control (full-list re-run) of A=1 / B=1 / tie=3, and node mapping A=9 / C=8 /
 * tie=1. In other words the pre-filter is STATISTICALLY INDISTINGUISHABLE from
 * the full list — the 11-6 mapping edge did NOT replicate once the truncation
 * was fixed, confirming it was noise. Aggregates agree: kept 14 / 14 (control)
 * / 15, mapped nodes 42 / 44 (control) / 49. The single gate crossing went to
 * the shrunk arm. THE JUSTIFICATION FOR THIS FEATURE IS COST AT PARITY QUALITY,
 * NOT A QUALITY IMPROVEMENT — do not cite one.
 *
 * RE-CALIBRATED 2026-07-23 on the TRUE 284-node tree (the earlier figures were
 * measured against a 260-node set, because loadSyllabusCandidates had a hard
 * `.limit(260)` that was silently truncating 24 real nodes): recall is 94.2%
 * for EN@150 and 93.7% for HI@220 over 728 assignments — ~2pts lower simply
 * because the pool is larger. Both blind panels found no regression at these
 * settings, and a panel on the live system outranks the recall proxy; the
 * English panel predates the truncation fix (it ran on 260), which is a
 * disclosed residual caveat, not a known defect.
 *
 * K IS A QUALITY DIAL, NOT A FREE COST KNOB. Recall degrades roughly in step
 * with the list: ~95% @150, ~87% @100, ~66% @40. Do not lower it for extra
 * savings without re-running the control-arm + blind-panel validation.
 */
import { supabase } from "../lib/supabase.js";
import { embeddings, EMBEDDING_DIMENSIONS, type EmbeddingUsage } from "../lib/embeddings.js";
import { logger } from "../lib/logger.js";
import type { SyllabusCandidate } from "./prompts.js";

/** Nodes kept per item for Latin-script items. See the K note above. */
export const PREFILTER_TOP_K = 150;

/**
 * Larger K for Devanagari items. The stored node vectors are English, and a
 * Hindi item's text matches them noticeably less sharply — MEASURED over 414
 * real node assignments (items carrying both language versions): recall@150 is
 * 96.4% for English item text but only 83.8% for the Hindi version of the SAME
 * items. This matters in production, not in theory: the `indiatv-uttar-pradesh`
 * source publishes entirely in Devanagari (verified live, 15/15 items).
 *
 * 220 is the K at which Hindi input reaches parity with the English bar at
 * 150, while still trimming ~19% off the prompt (measured on real Devanagari
 * feed items). A dedicated blind panel over Devanagari items found no
 * regression: the shrunk arm landed inside the noise floor set by a full-list
 * re-run of the same items. Two obvious-looking
 * alternatives were tested and are WORSE, do not "fix" this by reaching for
 * them: scoring against the hi node vectors (76.3%) or max(en,hi) (79.0%),
 * both below simply using the English vectors (83.8%). The English node
 * vectors are the more discriminative set regardless of the item's language;
 * the Hindi item text is the weak link.
 */
export const PREFILTER_TOP_K_DEVANAGARI = 220;

/** Below this many candidates there is nothing worth narrowing. */
const MIN_CANDIDATES_TO_FILTER = PREFILTER_TOP_K + 20;

/** Consecutive embed failures after which we stop trying for the rest of the run. */
const EMBED_FAILURE_LIMIT = 3;

/** Texts per embeddings call in the batch path. */
const EMBED_BATCH = 96;

const DEVANAGARI = /[ऀ-ॿ]/;

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

/**
 * Parses a stored pgvector value, rejecting anything malformed.
 *
 * The length/finiteness check is not paranoia: a NaN or short vector makes
 * cosine() return NaN, every comparison in the sort false, and Array.sort with
 * an inconsistent comparator yields an implementation-defined order — i.e. a
 * silently ARBITRARY 150 nodes with no error anywhere. Rejecting here instead
 * drops vector coverage below the candidate count, which disables the filter
 * and falls back to the full list. Loud-ish and correct beats silent and wrong.
 */
function parseVector(raw: unknown): number[] | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) return null;
  for (const n of v as unknown[]) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
  }
  return v as number[];
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
  private embedFailures = 0;

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
    // A coverage gap disables the filter, which is SAFE but is also a silent
    // ~33% cost regression, so name the gap loudly: the usual cause is nodes
    // added without a follow-up `pnpm ingest:embed`.
    if (candidates.length >= MIN_CANDIDATES_TO_FILTER && vectors.size !== candidates.length) {
      const missing = candidates.filter((c) => !vectors.has(c.id));
      logger.warn(
        { missing: missing.length, total: candidates.length, examples: missing.slice(0, 5).map((m) => m.title) },
        "ca prefilter: syllabus embedding coverage is incomplete — falling back to the FULL candidate list for every item (run `pnpm ingest:embed` to restore the saving)",
      );
    }
    return new CandidatePrefilter(candidates, vectors, k);
  }

  /**
   * Batch form of `narrow`, for callers that already hold every item up front
   * (the Message Batches backfill). Embeds in batches of EMBED_BATCH rather
   * than one call per item; same fail-open contract — on any error the affected
   * items get the FULL candidate list.
   */
  async narrowMany(
    items: { title: string; snippet: string }[],
    onUsage?: (usage: EmbeddingUsage) => void,
  ): Promise<SyllabusCandidate[][]> {
    const out: SyllabusCandidate[][] = items.map(() => this.candidates);
    if (!this.enabled || this.embedFailures >= EMBED_FAILURE_LIMIT) return out;

    for (let start = 0; start < items.length; start += EMBED_BATCH) {
      const slice = items.slice(start, start + EMBED_BATCH);
      const texts = slice.map((it) => `${it.title}\n${it.snippet}`.slice(0, 2000));
      // An empty/whitespace input would be rejected by the embeddings API and
      // take the whole batch down with it, so give those a harmless placeholder
      // and leave them on the full list below.
      const usable = texts.map((t) => (t.trim() ? t : null));
      try {
        const vecs = await embeddings().embed(
          usable.map((t) => t ?? "placeholder"),
          onUsage,
        );
        slice.forEach((_, j) => {
          const text = usable[j];
          const vec = vecs[j];
          if (!text || !vec || vec.length !== EMBEDDING_DIMENSIONS) return; // stays full list
          const k = DEVANAGARI.test(text) ? PREFILTER_TOP_K_DEVANAGARI : this.k;
          out[start + j] = this.candidates
            .map((c) => ({ c, score: cosine(vec, this.vectors.get(c.id)!) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map((r) => r.c);
        });
        this.embedFailures = 0;
      } catch (err) {
        // Share the latch with narrow(): a misconfigured key shouldn't retry
        // once per chunk for the rest of the run either.
        this.embedFailures++;
        logger.warn({ err, from: start, count: slice.length }, "ca prefilter: batch embed failed — those items use the full candidate list");
        if (this.embedFailures >= EMBED_FAILURE_LIMIT) {
          logger.warn(`ca prefilter: ${EMBED_FAILURE_LIMIT} consecutive embed failures — disabling for the rest of this run`);
          break;
        }
      }
    }
    return out;
  }

  /** True when we have enough coverage for narrowing to be safe. */
  get enabled(): boolean {
    return (
      this.candidates.length >= MIN_CANDIDATES_TO_FILTER &&
      this.vectors.size === this.candidates.length
    );
  }

  /**
   * Top-k candidates for this item, or the full list on any doubt.
   * `onUsage` surfaces the pre-filter's own embedding spend so callers can
   * fold it into their cost total instead of under-reporting.
   */
  async narrow(
    title: string,
    snippet: string,
    onUsage?: (usage: EmbeddingUsage) => void,
  ): Promise<SyllabusCandidate[]> {
    if (!this.enabled || this.embedFailures >= EMBED_FAILURE_LIMIT) return this.candidates;
    const text = `${title}\n${snippet}`.slice(0, 2000);
    if (!text.trim()) return this.candidates;
    // Devanagari items match the English node vectors less sharply, so they
    // need a wider net to hit the same recall — see PREFILTER_TOP_K_DEVANAGARI.
    const k = DEVANAGARI.test(text) ? PREFILTER_TOP_K_DEVANAGARI : this.k;
    try {
      const [vec] = await embeddings().embed([text], onUsage);
      if (!vec || vec.length !== EMBEDDING_DIMENSIONS) return this.candidates;
      this.embedFailures = 0;
      return this.candidates
        .map((c) => ({ c, score: cosine(vec, this.vectors.get(c.id)!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((r) => r.c);
    } catch (err) {
      this.embedFailures++;
      // A misconfigured key would otherwise throw once per item for the whole
      // run; latch off after a few failures instead of logging N times.
      if (this.embedFailures === EMBED_FAILURE_LIMIT) {
        logger.warn({ err }, `ca prefilter: ${EMBED_FAILURE_LIMIT} consecutive embed failures — disabling for this run, using the full candidate list`);
      } else if (this.embedFailures < EMBED_FAILURE_LIMIT) {
        logger.warn({ err }, "ca prefilter: embed failed for item — falling back to the full candidate list");
      }
      return this.candidates;
    }
  }
}
