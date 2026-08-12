/**
 * Fair round-robin ordering of candidate items across the configured sources.
 *
 * ---------------------------------------------------------------------------
 * ⚑ WHY THIS EXISTS — THE DEFECT IT CLOSES
 * ---------------------------------------------------------------------------
 * `runPipeline` used to walk `CA_SOURCES` in strict array order, taking up to
 * `maxPerSource` items from each until the RUN-WIDE `maxTotal` budget ran out:
 *
 *     for (const source of CA_SOURCES) {
 *       if (totalTaken() >= opts.maxTotal) { result.cappedTotal++; continue; }
 *       ...
 *       for (const item of feed.items) {
 *         if (totalTaken() >= opts.maxTotal) break;
 *         if (takenFromSource >= opts.maxPerSource) break;
 *
 * With the shipped defaults (`maxTotal` 40, `maxPerSource` 15) the first source
 * takes 15, the second 15, the third the remaining 10 — and **every source
 * after the third gets nothing at all** on any run where the leaders have 40
 * fresh items between them. Position in the array, not editorial value, decided
 * what the exam bank was built from.
 *
 * That is visible in the live corpus: the first three feeds account for 4,529 of
 * 5,178 items, while the two UP feeds (543 + 77) only ever got through on quiet
 * days when the leaders had nothing fresh left — dedupe skips don't consume the
 * budget, so a slow news day was the ONLY way a late source was reached.
 *
 * ⚑ AND IT MADE THE OBVIOUS COVERAGE FIX A NO-OP. Appending an economy or
 * science desk to `CA_SOURCES` — the natural response to "we have no economy
 * questions" — would have added a feed that is starved by construction and
 * changed nothing, while looking like a fix. Rotation is what makes adding a
 * source mean anything, so it ships WITH those sources, not after them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * Round-robin by position: one item from each source, then the next from each,
 * and so on. A source that runs out simply drops out of later rounds, so its
 * unused share flows to the others and a thin feed never wastes the budget.
 *
 * This is ORDERING ONLY. It does not decide how many items are taken, does not
 * apply `maxTotal`/`maxPerSource`, and does not skip anything — the caller keeps
 * every one of those checks exactly as before. That separation is deliberate:
 * the budget counters depend on per-item OUTCOMES (in sync mode `maxTotal`
 * counts items successfully processed, so a failed item must not consume a
 * slot), which cannot be known up front, whereas the ORDER can be — and being
 * pure is what makes the fairness property provable rather than argued.
 *
 * NOT weighted by syllabus coverage. That is the tempting next step and it is
 * deliberately not taken here: weighting would need a per-item topic, which is
 * only known AFTER the triage call this ordering exists to ration. Equal shares
 * across desks chosen per syllabus area (see `./sources.ts`) buys the breadth
 * without pretending to know an item's topic before paying to find out.
 *
 * Pure — no clock, no network, no DB, no randomness — so `pnpm --filter api
 * test:ca-rotation` can assert the fairness property directly.
 */

/** One item, tagged with the index of the source it came from. */
export interface RotatedItem<T> {
  sourceIndex: number;
  item: T;
}

/**
 * Interleave per-source item lists into one round-robin ordering.
 *
 * Sources are visited in their configured order WITHIN each round, so the array
 * order still breaks ties (round 0 is source 0's first item, then source 1's,
 * …) — but no source can consume another's share, which is the property that
 * was missing.
 *
 * Every input item appears exactly once; nothing is dropped or duplicated.
 */
export function interleaveBySource<T>(perSource: readonly (readonly T[])[]): RotatedItem<T>[] {
  const out: RotatedItem<T>[] = [];
  const longest = perSource.reduce((m, s) => Math.max(m, s.length), 0);
  for (let round = 0; round < longest; round++) {
    for (let sourceIndex = 0; sourceIndex < perSource.length; sourceIndex++) {
      // Bounds, NOT `item !== undefined`. `T` is generic, so a caller may legitimately
      // hold `undefined` as a value, and skipping on undefined would silently drop it
      // — breaking the "every input item appears exactly once" guarantee above for
      // exactly the caller who could least afford it. The pipeline's own EligibleItem
      // is never undefined, so this is latent rather than live; it is fixed anyway
      // because a utility that quietly loses elements is the wrong thing to leave in
      // a hot path someone will reuse.
      if (round >= perSource[sourceIndex].length) continue;
      out.push({ sourceIndex, item: perSource[sourceIndex][round] });
    }
  }
  return out;
}
