/**
 * The four numbers in the homepage stat strip.
 *
 * ⚑ These are REAL, MEASURED content counts — not the reference mockup's
 * "50K+ Aspirants / 98% Success Stories", which are placeholder marketing
 * numbers this product cannot honestly make (it has a few hundred accounts and
 * no outcome data at all). The mockup's VISUAL pattern is reproduced; its
 * claims are not. Same rule the pricing page follows with real plan prices.
 *
 * Static rather than fetched, on purpose: the landing page is prerendered
 * (`scripts/prerender.mjs`) and these are the crawler-visible proof numbers, so
 * a client-side fetch would leave the snapshot blank. They are also slow-moving
 * — the bank grows by ingest sessions, not by the hour.
 *
 * MEASURED 2026-08-12 against the live Supabase project. To refresh, re-run:
 *   questions  → questions where is_published and review_state='approved'  → 7,431
 *   chapters   → notes where status='published' and chapter_version >= 1   →   362
 *   briefs     → current_affairs_items where status='published'            → 3,006
 *   years      → min/max of questions.year                                 → 2016-2026
 *
 * Rounding is always DOWN to the nearest honest floor ("7,400+", never
 * "7,500"), so the displayed figure stays true as the bank grows.
 */
export type ContentStat = {
  /** i18n key under `Landing.` for the label under the numeral. */
  labelKey: string;
  /** Rendered as-is; already locale-neutral (Latin digits, as the app does for all scoreboard numerals). */
  value: string;
};

export const PYQ_YEAR_FROM = 2016;
export const PYQ_YEAR_TO = 2026;

/**
 * Per-exam past-year coverage, for the content hub's exam pages.
 *
 * MEASURED 2026-08-14 and recorded in `docs/content-strategy.md` §2a (which
 * carries the full per-year breakdown). To refresh:
 *   questions where is_published and review_state='approved' and source='pyq'
 *     group by exam_code, year
 *
 * ⚑ THIS IS A RANGE, NOT A COMPLETENESS CLAIM, and the distinction is load-bearing.
 * §2b records that UPPSC Prelims GS-I 2022 is ingested but effectively
 * unpublished (1 of 150, no verified answer key for that year) while CSAT 2022
 * is fine at 100 — so "papers from 2018 to 2025" is true, and "all eight years
 * of GS-I" would not be. Any page that quotes a per-year SERIES (the weightage
 * articles, slate #6 and #13) owes the reader that gap next to the chart; a hub
 * that states the span does not.
 *
 * ⚑ And never blur `source='pyq'` with generated practice items (§2a): 622 of
 * UPPSC's published questions and 66 of UPSC's are AI-generated, concentrated
 * in exactly the papers a sceptical reader checks first (CSAT, General Hindi).
 */
export const EXAM_PYQ_YEARS: Record<"uppsc" | "upsc", { from: number; to: number }> = {
  uppsc: { from: 2018, to: 2025 },
  upsc: { from: 2016, to: 2026 },
};

export const CONTENT_STATS: ContentStat[] = [
  { labelKey: "Landing.statQuestions", value: "7,400+" },
  { labelKey: "Landing.statChapters", value: "362" },
  { labelKey: "Landing.statBriefs", value: "3,000+" },
  { labelKey: "Landing.statYears", value: String(PYQ_YEAR_TO - PYQ_YEAR_FROM + 1) },
];
