/**
 * Magazine CURATION — the importance score + per-section caps that turn a
 * month's raw "cleared the survival gate" pile into an actual curated magazine.
 *
 * The survival gate (RELEVANCE_GATE = 2) only decides "keep vs archive"; it is
 * NOT a curation signal — in a busy month EVERY published item clears it (e.g.
 * 2026-07: 582 prelims-life + 836 mains-life items all at relevance 2). Left
 * unranked, the Prelims Compendium and Mains Analysis editions dumped hundreds
 * of write-ups per section. A real UPSC/UPPSC monthly (Vision PT365, Drishti's
 * monthly compilation) curates ~40-60 substantive items across a whole edition.
 *
 * The Deep Dives section already did this right (rank by relevance + rolled-up
 * syllabus weightage, cap at 5 — see ca/deepdive.ts `rankIssues`). This module
 * generalises exactly that mechanism to every section, and adds the "why this
 * made the cut" metadata (weightage_pct, editors_pick) the UI surfaces.
 */
import type { CurrentAffairsCategory } from "@neev/shared";
import { hotnessRaw, type OwnWeightage } from "../lib/weightage.js";

// ---------------------------------------------------------------------------
// Per-section caps — informed by what real monthly CA magazines actually run.
//
// Prelims Compendium (write-ups):  UP lead (≤10) + topic sections (≤36 total,
//   ≥1 per topic for coverage, ≤6 per topic so one category can't dominate) =
//   ≤46 write-ups, plus a boxed-fact appendix (≤8 per kind) and the existing
//   30-MCQ workbook.  →  ~40-55 curated items, not hundreds.
// Mains Analysis (issue briefs):   ≤36 curated briefs + 5 Deep Dives + 15
//   Model Questions.  →  ~40-55 analytical pieces.
// ---------------------------------------------------------------------------
export const UP_SPECIAL_LIMIT = 10;
export const TOPIC_TOTAL_LIMIT = 36;
export const TOPIC_PER_CATEGORY_MAX = 6;
export const BOXED_PER_KIND_LIMIT = 8;
export const MAINS_ISSUE_TOTAL_LIMIT = 36;
export const GS_PER_PAPER_MAX = 12;

/** A relevance-3 issue always outranks a relevance-2 one (mirrors deepdive rankIssues). */
const REL_TIER = 1000;
/** UP-specific prominence boost — the platform's flagship focus. Kept < REL_TIER so it never crosses a relevance tier. */
const UP_BOOST = 120;
/** Ceiling on the syllabus-weightage contribution, so a many-node item can't cross a relevance tier either. */
const WEIGHT_CAP = 400;
/** Newest-in-month nudge, at most ~one relevance-independent day's worth. */
const RECENCY_MAX = 30;
/**
 * An item is an "editor's pick" when it touches top-weightage syllabus (≥ this
 * normalized pct). Kept purely weightage-based — NOT relevance — on purpose:
 * relevance is already visible (the mains card's relevance badge; uniformly 2
 * on prelims), so the non-obvious "why this made the cut" reason is weightage.
 * A relevance disjunct would fire on every curated mains card (the top set is
 * all relevance-3) and stop being a subtle standout signal.
 */
export const EDITORS_PICK_WEIGHTAGE_PCT = 75;

const EMPTY_BY_YEAR = new Map<number, number>();

export interface CurationInputs {
  /** prelims_relevance | mains_relevance (2..3). */
  relevance: number;
  syllabus_node_ids: string[];
  is_up_specific: boolean;
  /** YYYY-MM-DD */
  date: string;
}

export interface Scored<T> {
  row: T;
  score: number;
  /** Rolled-up recency-decayed weightage of the touched syllabus nodes, normalized 0-100 vs the month's busiest item. */
  weightage_pct: number;
  editors_pick: boolean;
}

function rawScore(inp: CurationInputs, weightage: Map<string, OwnWeightage>, year: number): { score: number; hotness: number } {
  const hotness = inp.syllabus_node_ids.reduce(
    (s, id) => s + hotnessRaw(weightage.get(id)?.byYear ?? EMPTY_BY_YEAR, year),
    0,
  );
  const day = Number((inp.date ?? "").slice(8, 10)) || 1;
  const score =
    inp.relevance * REL_TIER + Math.min(hotness, WEIGHT_CAP) + (inp.is_up_specific ? UP_BOOST : 0) + (day / 31) * RECENCY_MAX;
  return { score, hotness };
}

/**
 * Score every row and sort by importance (desc). weightage_pct is normalized
 * against the busiest item in THIS set, so it reads as "high/low for this
 * month" rather than an absolute the reader can't calibrate.
 */
export function scoreRows<T>(
  rows: T[],
  toInputs: (r: T) => CurationInputs,
  weightage: Map<string, OwnWeightage>,
  year: number,
): Scored<T>[] {
  const withHot = rows.map((r) => {
    const { score, hotness } = rawScore(toInputs(r), weightage, year);
    return { r, score, hotness };
  });
  const maxHot = Math.max(1, ...withHot.map((x) => x.hotness));
  return withHot
    .map((x) => {
      const weightage_pct = Math.round((x.hotness / maxHot) * 100);
      return {
        row: x.r,
        score: x.score,
        weightage_pct,
        editors_pick: weightage_pct >= EDITORS_PICK_WEIGHTAGE_PCT,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Curate topic sections from score-sorted non-UP items: guarantee ≥1 per
 * populated category (coverage), never more than `perCategoryMax` (no category
 * dominates), and never more than `totalBudget` overall. Remaining budget after
 * the one-per-category reservation is filled by global score.
 *
 * Returns a category → curated-items map (each list still score-sorted).
 */
export function curateTopicSections<T>(
  sortedNonUp: Scored<T>[],
  categoryOf: (r: T) => CurrentAffairsCategory,
  perCategoryMax: number,
  totalBudget: number,
): Map<CurrentAffairsCategory, Scored<T>[]> {
  const byCat = new Map<CurrentAffairsCategory, Scored<T>[]>();
  for (const s of sortedNonUp) {
    const cat = categoryOf(s.row);
    const arr = byCat.get(cat) ?? [];
    arr.push(s); // input already score-desc, so each category list is too
    byCat.set(cat, arr);
  }

  // Reserve the top item of each populated category (coverage). If there are
  // more categories than the total budget, keep only the highest-scoring ones.
  let reserved = [...byCat.values()].map((arr) => arr[0]).sort((a, b) => b.score - a.score);
  if (reserved.length > totalBudget) reserved = reserved.slice(0, totalBudget);

  const result = new Map<CurrentAffairsCategory, Scored<T>[]>();
  for (const s of reserved) {
    const cat = categoryOf(s.row);
    result.set(cat, [s]);
  }

  // Fill the remaining budget from ranks 2..perCategoryMax, globally by score.
  let remaining = totalBudget - reserved.length;
  if (remaining > 0) {
    const pool: Scored<T>[] = [];
    for (const arr of byCat.values()) for (const s of arr.slice(1, perCategoryMax)) pool.push(s);
    pool.sort((a, b) => b.score - a.score);
    for (const s of pool) {
      if (remaining <= 0) break;
      const cat = categoryOf(s.row);
      const cur = result.get(cat);
      if (!cur || cur.length >= perCategoryMax) continue; // skip unreserved (dropped) categories or full ones
      cur.push(s);
      remaining--;
    }
  }

  for (const arr of result.values()) arr.sort((a, b) => b.score - a.score);
  return result;
}
