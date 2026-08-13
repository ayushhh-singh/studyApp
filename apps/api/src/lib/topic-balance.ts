/**
 * ONE topic-proportional selector, shared by every test-assembly surface.
 *
 * WHY THIS EXISTS. Three surfaces assemble papers from a pool — mocks
 * (`services/mocks.ts`), the daily quiz (`daily/quiz.ts`) and the current-affairs
 * sittings (`ca/assemble.ts`) — and before this module only ONE of them balanced
 * its topic mix. Measured on live data 2026-08-13:
 *
 *   mock:PRE_GS1:1        max section deviation  0.7pp   (weightedSample)
 *   mock:UPSC_PRE_GS1:1   max section deviation  0.5pp   (weightedSample)
 *   daily:2026-07-26:gs   max section deviation 13.1pp   (no balancing)
 *   daily:2026-07-31:gs   max section deviation 14.9pp   — Economic & Social
 *                                                          Development got ZERO
 *                                                          questions against a
 *                                                          15% target
 *   daily:2026-08-05:gs   max section deviation 21.4pp   — Environmental Ecology
 *                                                          took 8/25 (32%) on an
 *                                                          11% target while
 *                                                          Polity took 1/25 (4%)
 *                                                          on a 16% target
 *
 * A paper whose totals are right but whose internal mix is that skewed is not the
 * exam's pattern; it is a random draw wearing the exam's question count.
 *
 * WHY A DEFICIT-GREEDY PICKER RATHER THAN THE OLD TICKET INTERLEAVE. The daily
 * quiz cannot simply call the old `weightedSample`: its selection is split into
 * CONTENT-TYPE slices (generated / pyq / current-affairs / random) whose sizes are
 * a separate product decision, and balancing each slice independently does not
 * balance the paper — four separately-balanced slices drawn from four differently
 * shaped pools still compose into a skewed whole. So the balancer keeps its
 * running per-section counts OUTSIDE any one call (`running` + `placedTotal`) and
 * picks whichever section is furthest below its target GIVEN EVERYTHING PLACED SO
 * FAR. That composes across slices, and degrades to the single-call case for
 * mocks and CA.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *  - It never re-orders WITHIN a section. The caller's own ordering is preserved
 *    exactly, because each surface has its own meaningful within-section priority:
 *    CA ranks by relevance tier, the daily quiz's generated slice ranks by
 *    weak-topic priority, mocks shuffle. Balancing is a cross-section concern.
 *  - It never excludes a section. `minPerSection` runs first, so a section the
 *    commission rarely asks still appears; this is REWEIGHTING, not filtering
 *    (the same guarantee `MOCK_MIN_PER_SECTION` gave).
 *  - It never invents supply. A section that runs dry is skipped and its slots go
 *    to the next-most-deficient section, so a thin pool yields a full paper with
 *    an honest, reported deviation rather than a short one.
 *
 * PURE — no DB, no clock, no randomness. `pnpm --filter api test:balance` covers
 * it; every property above is asserted there.
 */

/** The minimum any selector may take from a populated section. */
export const DEFAULT_MIN_PER_SECTION = 1;

/** Anything with a section key. `top` is the top-level syllabus path segment. */
export interface TopicItem {
  id: string;
  top: string;
}

export interface BalancedPickOptions<T extends TopicItem> {
  /** Candidates, in the caller's own within-section priority order. */
  pool: T[];
  /** How many to take. Fewer are returned only when the pool is smaller. */
  count: number;
  /** Relative weight of a section — recency-weighted PYQ hotness at every call site. */
  weightOf: (top: string) => number;
  /**
   * Per-section counts already placed by EARLIER calls, mutated in place. Pass the
   * same Map across a multi-slice assembly so the balancer sees the whole paper.
   */
  running?: Map<string, number>;
  /** How many items earlier calls already placed (kept alongside `running`). */
  placedTotal?: number;
  /** Coverage floor per populated section. 0 disables it. */
  minPerSection?: number;
  /** Ids already chosen elsewhere in this paper — never picked again. */
  exclude?: ReadonlySet<string>;
}

/**
 * Select `count` items so the per-section mix tracks `weightOf`.
 *
 * Three phases, in order:
 *   1. Coverage floor — up to `minPerSection` from each populated section,
 *      heaviest section first (so a paper smaller than the section count still
 *      spends its floor where the commission asks most).
 *   2. Deficit fill — repeatedly take from the section whose share is furthest
 *      below target for the paper as a whole. Ties break on weight, then on
 *      section key so the result is deterministic given a deterministic pool.
 *   3. Top-up — if weighted supply ran out (every remaining section has weight 0,
 *      or the pool is thin), fill from whatever is left in pool order.
 */
export function balancedPick<T extends TopicItem>(opts: BalancedPickOptions<T>): T[] {
  const { pool, count, weightOf } = opts;
  const running = opts.running ?? new Map<string, number>();
  const minPerSection = opts.minPerSection ?? DEFAULT_MIN_PER_SECTION;
  const exclude = opts.exclude;
  let placedTotal = opts.placedTotal ?? 0;

  if (count <= 0 || pool.length === 0) return [];

  // Group, preserving the caller's order inside each group. A queue index per
  // group rather than splicing keeps this O(n).
  const groups = new Map<string, T[]>();
  const cursor = new Map<string, number>();
  for (const item of pool) {
    if (exclude?.has(item.id)) continue;
    const arr = groups.get(item.top);
    if (arr) arr.push(item);
    else {
      groups.set(item.top, [item]);
      cursor.set(item.top, 0);
    }
  }
  if (groups.size === 0) return [];

  const has = (top: string) => (cursor.get(top) ?? 0) < (groups.get(top)?.length ?? 0);
  const take = (top: string): T => {
    const i = cursor.get(top)!;
    cursor.set(top, i + 1);
    running.set(top, (running.get(top) ?? 0) + 1);
    placedTotal += 1;
    return groups.get(top)![i];
  };

  const picked: T[] = [];

  // Target share per section, over the sections this call can actually draw from
  // PLUS any already represented in `running` — otherwise a slice whose pool
  // covers only two sections would compute targets as if the paper had only two.
  const sections = new Set<string>([...groups.keys(), ...running.keys()]);
  let weightTotal = 0;
  for (const top of sections) weightTotal += Math.max(0, weightOf(top));
  const share = (top: string) => (weightTotal > 0 ? Math.max(0, weightOf(top)) / weightTotal : 0);

  // 1. Coverage floor, heaviest first.
  if (minPerSection > 0) {
    const order = [...groups.keys()].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0));
    for (const top of order) {
      for (let i = 0; i < minPerSection && picked.length < count && has(top); i++) {
        if ((running.get(top) ?? 0) >= minPerSection) break;
        picked.push(take(top));
      }
    }
  }

  // 2. Deficit fill.
  while (picked.length < count) {
    let best: string | null = null;
    let bestDeficit = -Infinity;
    let bestWeight = -Infinity;
    for (const top of groups.keys()) {
      if (!has(top)) continue;
      const w = Math.max(0, weightOf(top));
      if (w <= 0) continue; // weight-0 sections are floor/top-up only
      // Deficit measured against the paper size AFTER this hypothetical pick, so
      // the very first pick of a slice is still comparable across sections.
      const deficit = share(top) * (placedTotal + 1) - (running.get(top) ?? 0);
      if (deficit > bestDeficit || (deficit === bestDeficit && w > bestWeight)) {
        best = top;
        bestDeficit = deficit;
        bestWeight = w;
      }
    }
    if (!best) break;
    picked.push(take(best));
  }

  // 3. Top-up from anything left, in pool order.
  if (picked.length < count) {
    for (const item of pool) {
      if (picked.length >= count) break;
      if (exclude?.has(item.id)) continue;
      const arr = groups.get(item.top);
      const i = cursor.get(item.top) ?? 0;
      if (!arr || i >= arr.length) continue;
      // Only take it if it is genuinely the group's next unconsumed item, so the
      // caller's within-section order still holds.
      if (arr[i].id !== item.id) continue;
      picked.push(take(item.top));
    }
  }

  return picked;
}

/**
 * Largest per-section deviation between an assembled paper and its weightage
 * target, in percentage points — the number every surface logs after assembly, so
 * a regression shows up in a build log rather than in a student's paper.
 *
 * Sections with no weight and no questions are ignored; a section that appears in
 * EITHER the paper or the target counts, so both an over-represented section and a
 * completely missing one are caught.
 */
export function maxSectionDeviationPct(
  items: readonly TopicItem[],
  weightOf: (top: string) => number,
  sections: Iterable<string>,
): number {
  if (items.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.top, (counts.get(it.top) ?? 0) + 1);
  const all = new Set<string>([...counts.keys(), ...sections]);
  let weightTotal = 0;
  for (const top of all) weightTotal += Math.max(0, weightOf(top));
  let worst = 0;
  for (const top of all) {
    const actual = ((counts.get(top) ?? 0) / items.length) * 100;
    const target = weightTotal > 0 ? (Math.max(0, weightOf(top)) / weightTotal) * 100 : 0;
    worst = Math.max(worst, Math.abs(actual - target));
  }
  return worst;
}
