/**
 * Stage D — near-duplicate detection. Embeds each candidate (stem plus its
 * options — see `dedupTextOf`) and compares (cosine) against (a) the node's
 * existing question bank and (b) the other candidates in this run. A candidate
 * whose best match is at/above its kind's threshold (`DEDUP_THRESHOLD_BY_KIND`)
 * is rejected as a duplicate; every candidate keeps its nearest existing hits so
 * the Review Queue can show the reviewer what it resembles.
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
 * Cosine at/above which two questions are treated as the same question.
 *
 * ⚑ BOTH ARE 0.9, AND THAT IS A MEASURED RESULT — DO NOT "TIGHTEN THEM TO MATCH
 * THE DATA". That is exactly what was tried on 2026-08-13 and it was WRONG.
 *
 * The reasoning that fails: real PYQ pairs on the SAME node are distinct by
 * construction (the commission set both), so a gate should never reject a pair
 * less similar than the most-similar real pair — sample that population, set the
 * threshold just above its max. Sampled over 12 nodes per kind it gives max 0.835
 * (descriptive) and 0.846 (MCQ), suggesting 0.84 / 0.85.
 *
 * ⚑ THAT SAMPLE WAS AN UNDERCOUNT, and re-measuring EXHAUSTIVELY over every
 * same-node pair inverts the conclusion. A "false rejection" below means a real
 * pair that is NOT byte-identical yet scores at/above the threshold:
 *
 *   DESCRIPTIVE, n=6,108 exhaustive (was n=431 sampled):
 *     0.90 →  3 false / 3 true      0.84 → 13 false / 3 true
 *   MCQ, n=14,031 exhaustive, stem+options (was n=2,248 sampled):
 *     0.90 →  5 false / 1 true      0.85 → 24 false / 1 true
 *
 * ⚑ AND THE REASON IS NOT NOISE — THE COMMISSION GENUINELY RE-ASKS. "Critically
 * analyse the role of Sardar Patel in the Unification of India" (MAINS_GS1 2025)
 * against "Discuss the role of Sardar Patel in the unification of India" (2023)
 * sits at **0.9254**; irrigation projects of UP 2022/2019 at 0.9178; the
 * philosophical basis of probity 2018/2020 at 0.9034. Those are real, distinct,
 * separately-set questions. So the "generated duplicate" and "authentic re-ask"
 * distributions genuinely OVERLAP, and no cosine threshold separates them —
 * because semantically they are the same thing. A generator producing something
 * that close to an existing PYQ is producing something exam-authentic.
 *
 * Consequence, stated plainly: the near-duplicate pairs the 2026-08-13 quality
 * panel flagged (0.847-0.896) are NOT reachable by this stage at any safe
 * threshold. Duplication in generated output needs a DIFFERENT mechanism — see
 * `docs/OUTSTANDING.md` §9 G16. Tightening here would instead have systematically
 * suppressed the SCAFFOLDED FORMATS (assertion-reason, match-list), whose stems
 * are long boilerplate: at 0.85, 24 of the 25 rejections are that class. That
 * would have fought directly against the corrected format mix in
 * `uppsc.qgen.formatGuidance`, which exists to produce MORE of them.
 *
 * The key set is deliberately NOT `QuestionType`. `dedupCandidates`' parameter is
 * `keyof typeof` this map, so widening `questionTypeSchema` to a third kind is a
 * COMPILE ERROR at the call site rather than a lookup returning `undefined` —
 * and `maxSimilarity >= undefined` is always false, i.e. the gate would silently
 * switch OFF for the new kind. Verified by widening the type in a throwaway
 * probe: TS2322 at the assignment, which is the loud direction. The map is kept
 * per-kind (rather than collapsed back to one constant) precisely so the next
 * person to re-derive these has somewhere to put a per-kind answer.
 */
export const DEDUP_THRESHOLD_BY_KIND = { mcq: 0.9, descriptive: 0.9 } as const;

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
    // OpenAI rejects an empty-string input with a 400, so a placeholder is
    // needed — but see the caller: empty EXISTING rows are dropped before they
    // get here, because every one of them renders to this same placeholder and
    // therefore matches every other at cosine 1.0.
    const vecs = await provider.embed(texts.slice(i, i + batchSize).map((t) => t || "(empty question)"));
    for (const v of vecs) out.push(normalize(v));
  }
  return out;
}

/** The bilingual option shape as stored in `questions.options_i18n`. */
interface StoredOption {
  key?: string;
  text_i18n?: { en?: string; hi?: string };
}

/**
 * The text a question is compared BY: its stem, plus its options when it has any.
 *
 * ⚑ BOTH SIDES OF EVERY COMPARISON MUST USE THIS. A candidate rendered one way
 * and the existing bank rendered another produces a similarity that means
 * nothing, and it would fail silently — the numbers still look like cosines.
 *
 * Including the options is a STRICT improvement at every threshold, and that is
 * the whole justification — it did NOT license a tighter threshold (see
 * `DEDUP_THRESHOLD_BY_KIND`, where trying that was the mistake). A match-list
 * stem is boilerplate and its content lives entirely in the options: two real
 * published PYQs sharing the exact stem "Which of the following is not correctly
 * matched?" embed at cosine **1.0000** on the stem alone and **0.3621** with
 * their options, i.e. under stem-only they were indistinguishable from a true
 * duplicate at ANY threshold. 21 real stem-sharing groups exist, the largest
 * with 11 members. Measured over all 14,031 real same-node MCQ pairs, false
 * rejections fall from **11 to 5** at 0.90 and from 25 to 24 at 0.85 — better
 * everywhere, and it removes the cosine-1.0 collision class outright.
 *
 * Descriptive questions carry no options, so this is a **provable no-op** for
 * them: 0 of 1,693 real descriptive PYQs render differently.
 */
export function dedupTextOf(stem: string, options?: readonly StoredOption[] | null): string {
  const head = (stem ?? "").replace(/\s+/g, " ").trim();
  const opts = (options ?? [])
    .map((o) => `${o.key ?? ""}) ${(o.text_i18n?.en ?? o.text_i18n?.hi ?? "").replace(/\s+/g, " ").trim()}`.trim())
    .filter((s) => s.length > 2);
  return [head, ...opts].join("\n").trim();
}

/** A candidate as this stage compares it: the rendered text, nothing else. */
export interface DedupCandidate {
  stem: string;
  options?: readonly StoredOption[] | null;
}

/**
 * @param kind REQUIRED even though both kinds currently share one threshold —
 *   the two populations were measured separately and could diverge again, and a
 *   defaulted trailing parameter is how a caller silently keeps the old
 *   behaviour (this repo's M24 lesson). Making it required forces every call
 *   site to state which it is, and is what makes widening `questionTypeSchema` a
 *   compile error rather than a silently-disabled gate.
 */
export async function dedupCandidates(
  nodeId: string | null,
  candidates: readonly DedupCandidate[],
  kind: keyof typeof DEDUP_THRESHOLD_BY_KIND,
): Promise<DedupResult[]> {
  const threshold = DEDUP_THRESHOLD_BY_KIND[kind];
  const clean = candidates.map((c) => dedupTextOf(c.stem, c.options));
  const empty = (): DedupResult[] => clean.map(() => ({ isDuplicate: false, maxSimilarity: 0, nearest: [] }));
  if (clean.length === 0) return [];

  try {
    // Existing bank for this node (any review_state — avoid regenerating a
    // near-dupe of something already pending review, too). `options_i18n` is
    // selected so the existing side renders through the SAME `dedupTextOf` as
    // the candidates; see its note.
    let existingIds: string[] = [];
    let existingTexts: string[] = [];
    if (nodeId) {
      const { data, error } = await supabase()
        .from("questions")
        .select("id, stem_i18n, options_i18n")
        .eq("syllabus_node_id", nodeId)
        .limit(500);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const stem = r.stem_i18n as { en?: string; hi?: string };
        const text = dedupTextOf(stem.en || stem.hi || "", r.options_i18n as StoredOption[] | null);
        // ⚑ DROP EMPTY ROWS, and this is not hygiene. `embedAll` substitutes one
        // placeholder for empty text, so every empty row embeds identically and
        // matches every other at cosine 1.0 — measured 2026-08-13, 11 real
        // `UPSC_PRE_CSAT` rows whose English stem failed to extract collide that
        // way. Keeping them would let a broken candidate be "deduplicated"
        // against unrelated broken rows. (Pre-existing: an empty STEM behaved the
        // same before options were included. The old comment here claimed such an
        // embedding "just won't match anything", which is the opposite of true.)
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
