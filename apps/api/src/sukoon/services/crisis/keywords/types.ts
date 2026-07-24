import type { SukoonCrisisLevel } from "@neev/shared";

/**
 * Shape shared by the three per-language keyword modules (en/hi/hinglish).
 * Kept tiny and declarative on purpose: the curated LISTS are the reviewed
 * safety surface (SUKOON_CONTEXT: "I will review the keyword lists…"), and the
 * matching semantics live once in keywordDetector.ts — never in the data.
 */

/** One crisis phrase and the level it implies. */
export interface CrisisPhrase {
  /** The phrase to look for (author it exactly as a user would type it, lowercase). */
  pattern: string;
  level: SukoonCrisisLevel;
}

export interface CrisisKeywordList {
  /**
   * STRONG phrases — unambiguous first-person self-harm / severe-distress
   * intent. These ALWAYS fire (never suppressed by a joke/negation marker):
   * safety-first, a false positive here is acceptable, a false negative is not.
   */
  strong: CrisisPhrase[];
  /**
   * WEAK keywords — a bare, ambiguous token ("suicide") that could be genuine
   * OR discussion/quotation. Fires ONLY when no suppressor (below) is present
   * in the same message.
   */
  weak: CrisisPhrase[];
  /**
   * SUPPRESSORS — markers that make a WEAK keyword benign: jokes/quotation
   * ("mazak", "just kidding"), explicit "I'm fine" reassurance, or topical
   * discussion context ("suicide prevention essay"). Never affects STRONG
   * phrases. Deliberately excludes generic negatives like bare "nahi"/"not",
   * which appear inside real crisis statements ("jeena nahi chahta").
   */
  suppressors: string[];
}
