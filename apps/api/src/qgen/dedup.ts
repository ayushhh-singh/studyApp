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
  /**
   * Set when the SAME-ANSWER rule fired rather than the cosine one — the two
   * catch different things, so the reason has to be distinguishable or a future
   * tuning pass cannot tell which signal is doing the work. Carries the
   * normalised answer text the candidate collided on.
   */
  sameAnswerAs?: { question_id: string | null; answer: string };
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

/** A candidate as this stage compares it: the rendered text, plus its own answer. */
export interface DedupCandidate {
  stem: string;
  options?: readonly StoredOption[] | null;
  /** The option key this candidate is keyed to, for the same-answer check below. */
  correctOptionKey?: string | null;
}

/**
 * ⚑ THE SAME-ANSWER CHECK — why a second signal exists at all.
 *
 * Cosine similarity provably cannot catch same-FACT duplication, and this is
 * measured, not argued. The generated duplicates a blind panel caught on
 * 2026-08-13 sit at **0.7833** ("Who founded the city of Jaunpur?" vs "The city
 * of Jaunpur was founded in 1359 CE by which Tughlaq ruler?"), **0.7613** and
 * **0.7921** — while `DEDUP_THRESHOLD_BY_KIND`'s own note records the
 * commission's genuine RE-ASKS at **0.9034-0.9254**. The two distributions are
 * not merely overlapping, they are INVERTED: a threshold low enough to catch the
 * duplicates sits 0.15 BELOW where real repeat questions live. No setting works.
 *
 * What separates them is the ANSWER. Two MCQs on one node keyed to the same
 * substantive answer are testing the same fact however differently they are
 * worded — measured, the generated pairs this catches have stem overlap as low
 * as **0.00**, i.e. exactly the region text similarity cannot reach.
 *
 * MEASURED EXHAUSTIVELY (G16's lesson — both populations are enumerable, so a
 * sample is not good enough). Over every real same-node MCQ pair in the bank:
 *
 *   real pairs with a substantive answer      52,805
 *   ...sharing that answer (false rejections)     80  = 0.152%
 *   generated pairs sharing an answer             72  = 0.066%
 *
 * and inspection shows a good share of those 80 are genuine commission re-asks
 * (two real UPPSC items keyed "mental set" differ only by person/subject), i.e.
 * the rule is finding real duplication on both sides rather than misfiring.
 *
 * NO stem-similarity floor is applied on purpose. Adding one would re-introduce
 * exactly the blindness this exists to remove — the clearest true positives
 * measured at jaccard 0.00-0.20.
 */
export function answerTextOf(options: readonly StoredOption[] | null | undefined, correctKey: string | null | undefined): string | null {
  if (!options || !correctKey) return null;
  const hit = options.find((o) => (o.key ?? "").toUpperCase() === correctKey.toUpperCase());
  const t = (hit?.text_i18n?.en ?? hit?.text_i18n?.hi ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 3) return null;
  return isCombinationAnswer(t) ? null : t;
}

/**
 * ⚑ A COMBINATION CLOSURE IS NOT A FACT, and skipping these is load-bearing.
 * "2 and 3 only", "Both 1 and 2", "1 2 and 3", "None of the above", a match-list
 * code like "a 1 b 2 c 3 d 4" — unrelated questions share these constantly.
 * MEASURED: comparing them too takes false rejections from **80 to 1,385** (of
 * 160,967 real pairs), because ~2/3 of all MCQ answers in this bank ARE such
 * closures. Two questions keyed "2 and 3 only" have nothing in common.
 */
export function isCombinationAnswer(t: string): boolean {
  if (/^(both|neither|none|all|only)\b/.test(t)) return true;
  if (
    /\b(only|and|nor)\b/.test(t) &&
    /\d/.test(t) &&
    !/[a-z]{4,}/.test(t.replace(/\b(only|and|nor|both|neither|all|none|statements?|above)\b/g, ""))
  ) {
    return true;
  }
  if (/^[\d\s,]+$/.test(t)) {
    // ⚑ A LIST of small integers is a code ("1 2 3 4"); a SINGLE number is a real
    // value and must be kept — an arithmetic item's answer ("22338" for an LCM)
    // identifies its fact as well as a name does. Excluding bare numerics whole
    // was tried and is measurably worse: it catches 8 fewer generated duplicates
    // (72 vs 80) while its false-rejection RATE is no better (0.152% vs 0.142%),
    // i.e. the feared "two different sums, same answer" collision does not show
    // up in the real bank.
    const toks = t.split(/[\s,]+/).filter(Boolean);
    return toks.length >= 2 && toks.every((x) => x.length <= 2);
  }
  if (/^[a-d\d\s,]+$/.test(t) && t.replace(/[^a-d]/g, "").length >= 2) return true;
  if (/^(i|ii|iii|iv|v)(\s+(i|ii|iii|iv|v))+$/.test(t)) return true;
  return false;
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
    /** answer text → the id of the first existing question keyed to it. */
    const existingAnswers = new Map<string, string>();
    if (nodeId) {
      const { data, error } = await supabase()
        .from("questions")
        .select("id, stem_i18n, options_i18n, correct_option_key")
        .eq("syllabus_node_id", nodeId)
        .limit(500);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const stem = r.stem_i18n as { en?: string; hi?: string };
        const ans = answerTextOf(r.options_i18n as StoredOption[] | null, r.correct_option_key as string | null);
        if (ans && !existingAnswers.has(ans)) existingAnswers.set(ans, r.id as string);
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

    // Answers seen EARLIER IN THIS RUN, so a batch that produces three questions
    // with one answer keeps the first — the same first-wins rule the cosine pass
    // uses, and the shape the 2026-08-13 panel actually caught (three generated
    // "who founded Jaunpur" items in one 23-question set).
    const runAnswers = new Map<string, number>();
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

      // SAME-ANSWER rule — see `answerTextOf`. Independent of cosine on purpose.
      const ans = answerTextOf(candidates[i].options, candidates[i].correctOptionKey);
      let sameAnswerAs: DedupResult["sameAnswerAs"];
      if (ans) {
        const existingId = existingAnswers.get(ans);
        if (existingId) sameAnswerAs = { question_id: existingId, answer: ans };
        else if (runAnswers.has(ans)) sameAnswerAs = { question_id: null, answer: ans };
        else runAnswers.set(ans, i);
      }

      return {
        isDuplicate: maxSimilarity >= threshold || !!sameAnswerAs,
        maxSimilarity,
        nearest: hits,
        ...(sameAnswerAs ? { sameAnswerAs } : {}),
      };
    });
  } catch (err) {
    logger.warn({ err, nodeId }, "qgen dedup failed; treating all candidates as unique");
    return empty();
  }
}
