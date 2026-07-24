import {
  crisisLevelRank,
  maxCrisisLevel,
  type SukoonCrisisLevel,
} from "@neev/shared";
import type { CrisisKeywordList, CrisisPhrase } from "./keywords/types.js";
import { enKeywords } from "./keywords/en.js";
import { hiKeywords } from "./keywords/hi.js";
import { hinglishKeywords } from "./keywords/hinglish.js";

/**
 * Layer 1 of the crisis detector — a PURE, deterministic keyword matcher over
 * the three reviewed language lists (en / hi / hinglish). No I/O, no model, no
 * async: zero latency, zero cost, and fully testable in CI (the red-team
 * suite). It catches the obvious; Layer 2 (the classifier) catches the subtle.
 *
 * Matching semantics (the ONE place they live — the lists carry only data):
 *  - Input is lowercased + NFC-normalized (so Devanagari nukta forms compare
 *    equal regardless of composition) and every non-alphanumeric, non-Devanagari
 *    char becomes a space, collapsed and padded → a boundary-safe haystack.
 *  - LATIN patterns match on WORD BOUNDARIES (` pattern ` in the padded text),
 *    so "die" never matches inside "studied" and "so stressed" matches as a run.
 *  - DEVANAGARI patterns match as substrings (Hindi glues inflections; the lists
 *    keep those patterns long enough that this is safe).
 *  - STRONG phrases (first-person intent) ALWAYS fire.
 *  - WEAK keywords at moderate+ (lone self-harm nouns) fire only when NO
 *    suppressor is present; WEAK `low` keywords (mild distress) always fire —
 *    a topical marker like "essay" must neutralize "suicide", never "stressed".
 */

const LISTS: CrisisKeywordList[] = [enKeywords, hiKeywords, hinglishKeywords];
const MODERATE_RANK = crisisLevelRank("moderate");

/** True if the pattern contains any Devanagari codepoint (U+0900–U+097F). */
function isDevanagari(pattern: string): boolean {
  return /[ऀ-ॿ]/.test(pattern);
}

/**
 * Normalize once per assessment (and per pattern, identically — that symmetry
 * is what makes matching work): NFC (unify Devanagari composition), lowercase,
 * DELETE apostrophes so a contraction collapses to one token ("don't" → "dont",
 * "i'm" → "im"), replace every remaining run of non-alphanumeric/non-Devanagari
 * with a single space, and pad with a leading+trailing space so a boundary match
 * at either end still sees a space.
 */
export function normalizeForMatch(text: string): string {
  const cleaned = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’ʼ]/g, "")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim();
  return ` ${cleaned} `;
}

/**
 * Does the haystack contain this pattern? The pattern is normalized through the
 * SAME pipeline, so authoring it with or without apostrophes/punctuation is
 * equivalent. Latin patterns match on word boundaries (the padded ` p ` form);
 * Devanagari patterns match as substrings (Hindi inflection glue).
 */
function haystackHas(haystack: string, pattern: string): boolean {
  const padded = normalizeForMatch(pattern); // ` cleaned `
  const inner = padded.slice(1, -1); // drop the pad → "cleaned"
  if (!inner) return false;
  return isDevanagari(pattern) ? haystack.includes(inner) : haystack.includes(padded);
}

/** The first matching phrase in a list, or null. */
function findMatch(haystack: string, phrases: CrisisPhrase[]): CrisisPhrase | null {
  for (const phrase of phrases) {
    if (haystackHas(haystack, phrase.pattern)) return phrase;
  }
  return null;
}

export interface KeywordMatch {
  level: SukoonCrisisLevel;
  /** The phrase that set the winning level — for the engine's `reason`, never stored. */
  matched: string | null;
}

/**
 * Run Layer 1. Returns the highest level any list produces, and the phrase that
 * won (for logging/UX reasoning only — never persisted; the crisis-events table
 * stores level + layer + time, no text).
 */
export function detectKeywordLevel(text: string): KeywordMatch {
  const haystack = normalizeForMatch(text);

  // A suppressor from ANY language neutralizes a moderate+ weak keyword in ANY
  // language (code-mixed messages are the norm — "आत्महत्या essay, im fine").
  const suppressed = LISTS.some((list) =>
    list.suppressors.some((s) => haystackHas(haystack, s)),
  );

  let best: SukoonCrisisLevel = "none";
  let matched: string | null = null;

  const consider = (candidate: CrisisPhrase | null): void => {
    if (!candidate) return;
    if (crisisLevelRank(candidate.level) > crisisLevelRank(best)) {
      best = candidate.level;
      matched = candidate.pattern;
    }
  };

  for (const list of LISTS) {
    // Strong phrases always count.
    consider(findMatch(haystack, list.strong));

    // Weak: split by rank so suppression only touches the moderate+ (self-harm
    // noun) tier, never the mild-distress `low` tier.
    const weakSevere = list.weak.filter((w) => crisisLevelRank(w.level) >= MODERATE_RANK);
    const weakMild = list.weak.filter((w) => crisisLevelRank(w.level) < MODERATE_RANK);
    if (!suppressed) consider(findMatch(haystack, weakSevere));
    consider(findMatch(haystack, weakMild));
  }

  // maxCrisisLevel is a no-op here (best already the max) but documents intent
  // and keeps the "one ordering" invariant visible at the return.
  return { level: maxCrisisLevel(best, "none"), matched };
}
