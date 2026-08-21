/**
 * Pure-function guards for the qgen planner's two plan-list combinators, plus
 * the `--series <slug>` mode's two pure helpers. No DB, no clock, no model, no
 * network — the same contract as `test:args`, `test:mentor` and `test:tips`.
 *
 * WHY THIS EXISTS: `mergePlans` is defensive code with ZERO live instances
 * (measured 2026-08-13, the coverage and fresh-supply passes collide on 0 nodes),
 * so without a test it ships unexercised and stays that way until the night it
 * first matters. `trimToBudget` is covered here too because the interesting
 * property — that ONE cap bounds a MULTI-EXAM run — cannot be demonstrated from
 * live data while only one exam is ever in shortfall. `matchingLeaves` and
 * `distributeByHotness` (2026-08-19) are the two pieces of `series-demand.ts`
 * that decide WHICH topic gets generated for — a wrong prefix match or a wrong
 * distribution silently tops up the wrong syllabus section, which is exactly
 * the class of bug this whole feature exists to stop happening again.
 */
import { mergePlans, trimToBudget } from "../src/qgen/topup.js";
import { matchingLeaves, distributeByHotness } from "../src/qgen/series-demand.js";
import { answerTextOf, isCombinationAnswer } from "../src/qgen/dedup.js";
import type { GeneratePlan } from "../src/qgen/generate.js";

let pass = 0;
const failures: string[] = [];
function check(label: string, cond: boolean) {
  if (cond) pass += 1;
  else failures.push(label);
}

/** A plan carrying only the fields these two pure functions actually read. */
function plan(nodeId: string, kind: "mcq" | "descriptive", count: number, examCode = "uppsc"): GeneratePlan {
  return {
    node: {
      id: nodeId,
      paperCode: "PRE_GS1",
      examCode,
      stage: "prelims",
      title_i18n: { en: nodeId, hi: nodeId },
      description_i18n: null,
    },
    count,
    kind,
  };
}

// ---------------------------------------------------------------------------
// mergePlans
// ---------------------------------------------------------------------------
{
  // The case it exists for: one node named by both passes must be generated ONCE.
  const merged = mergePlans([plan("a", "mcq", 4), plan("a", "mcq", 9)]);
  check("collision on (node, kind) collapses to one plan", merged.length === 1);
  check("collision keeps the LARGER count (satisfies both floors)", merged[0]?.count === 9);

  // Order must not decide the winner — the passes run in a fixed order today, but
  // nothing about the contract should depend on it.
  const reversed = mergePlans([plan("a", "mcq", 9), plan("a", "mcq", 4)]);
  check("larger count wins regardless of input order", reversed[0]?.count === 9);

  // The SAME node for two different kinds is two real plans, not a collision:
  // a node can be short on MCQs and on descriptives independently.
  const twoKinds = mergePlans([plan("a", "mcq", 3), plan("a", "descriptive", 2)]);
  check("same node, different kind → NOT merged", twoKinds.length === 2);

  // Distinct nodes are never merged, and nothing is dropped.
  const distinct = mergePlans([plan("a", "mcq", 3), plan("b", "mcq", 5), plan("c", "mcq", 1)]);
  check("distinct nodes all survive", distinct.length === 3);
  check("distinct nodes keep their own counts", distinct.map((p) => p.count).join(",") === "3,5,1");

  // Degenerate inputs must not throw.
  check("empty input → empty output", mergePlans([]).length === 0);
  check("single plan passes through unchanged", mergePlans([plan("a", "mcq", 7)])[0]?.count === 7);

  // Three-way collision (a node named by both passes twice over) still collapses.
  const triple = mergePlans([plan("a", "mcq", 2), plan("a", "mcq", 11), plan("a", "mcq", 5)]);
  check("three-way collision collapses to the max", triple.length === 1 && triple[0]?.count === 11);

  // Node ids are globally unique, but two exams' plans share one list — a merge
  // keyed on anything less specific than the node id would wrongly fuse them.
  const crossExam = mergePlans([plan("a", "mcq", 3, "uppsc"), plan("b", "mcq", 4, "upsc")]);
  check("plans from different exams are not fused", crossExam.length === 2);
}

// ---------------------------------------------------------------------------
// trimToBudget
// ---------------------------------------------------------------------------
{
  // Smallest-first: the most nodes served per dollar. With a cap that admits only
  // part of the list, the SMALL plans must be the ones kept.
  const many = [plan("a", "mcq", 20), plan("b", "mcq", 1), plan("c", "mcq", 1)];
  const trimmed = trimToBudget(many, 0.05);
  check("a binding cap keeps the smallest plans first", trimmed.kept.every((p) => p.count === 1));
  check("dropped count is reported, never silent", trimmed.dropped === many.length - trimmed.kept.length);

  // ONE cap must bound the WHOLE multi-exam run — the property that cannot be
  // seen live while only one exam is ever in shortfall.
  const twoExams = [plan("a", "mcq", 5, "uppsc"), plan("b", "mcq", 5, "upsc")];
  const both = trimToBudget(twoExams, 1000);
  check("a generous cap keeps every exam's plans", both.kept.length === 2 && both.dropped === 0);
  const none = trimToBudget(twoExams, 0);
  check("a zero cap keeps nothing and drops everything", none.kept.length === 0 && none.dropped === 2);
  check("a zero cap spends nothing", none.estUsd === 0);

  check("empty input → nothing kept, nothing dropped", trimToBudget([], 5).dropped === 0);
  check("estimate is non-negative and finite", Number.isFinite(both.estUsd) && both.estUsd >= 0);
}

// ---------------------------------------------------------------------------
// Stage-D same-answer rule (dedup.ts) — the half cosine provably cannot do.
// ---------------------------------------------------------------------------
{
  const opt = (key: string, en: string) => ({ key, text_i18n: { en, hi: "" } });
  const OPTS = [opt("A", "Firoz Shah Tughlaq"), opt("B", "Sikandar Lodi"), opt("C", "Sher Shah Suri"), opt("D", "Akbar")];

  check("a substantive answer is extracted, normalised", answerTextOf(OPTS, "A") === "firoz shah tughlaq");
  check("the key is matched case-insensitively", answerTextOf(OPTS, "a") === "firoz shah tughlaq");
  check("a key naming no option yields null", answerTextOf(OPTS, "Z") === null);
  check("no options (a descriptive candidate) yields null", answerTextOf(null, "A") === null);
  check("no key yields null", answerTextOf(OPTS, null) === null);
  check("two questions keyed to the same option TEXT collide", answerTextOf(OPTS, "A") === answerTextOf([opt("C", "Firoz Shah Tughlaq")], "C"));

  // ⚑ The load-bearing exclusion. Measured: comparing combination closures takes
  // false rejections from 80 to 1,385 over the real bank, because ~2/3 of MCQ
  // answers ARE such closures and unrelated questions share them constantly.
  for (const t of [
    "both 1 and 2", "neither 1 nor 2", "1 only", "2 and 3 only", "1 2 and 3",
    "all of the above", "none of the above", "1 2 3 4", "a 1 b 2 c 3 d 4", "i ii iii",
  ]) {
    check(`combination closure excluded: "${t}"`, isCombinationAnswer(t));
  }
  for (const t of ["firoz shah tughlaq", "mental set", "cauvery river", "special investigation team sit", "algorithm", "22338"]) {
    check(`substantive answer kept: "${t}"`, !isCombinationAnswer(t));
  }
  check("a combination-keyed question yields no comparable answer", answerTextOf([opt("A", "Both 1 and 2")], "A") === null);
  check("a too-short answer yields null", answerTextOf([opt("A", "x")], "A") === null);

  // ⚑ DEVANAGARI. Two separate defects were found here by audit, both latent
  // only because every MCQ in the bank happens to carry English option text:
  //  1. the ASCII rules above cannot see a Hindi closure at all;
  //  2. worse, the normaliser dropped `\p{M}`, so matras were stripped and
  //     दोनों ("both") collapsed to "द न" — as does दिन ("day"), i.e. two
  //     unrelated words became the same string and would be called duplicates.
  const hi = (en: string, hiText: string) => ({ key: "A", text_i18n: { en, hi: hiText } });
  check("matras survive normalisation (दोनों ≠ दिन)", answerTextOf([hi("", "दोनों")], "A") !== answerTextOf([hi("", "दिन")], "A"));
  check("नहीं and नहि stay distinct", answerTextOf([hi("", "नहीं")], "A") !== answerTextOf([hi("", "नहि")], "A"));
  for (const t of ["दोनों 1 और 2", "न तो 1 न ही 2", "केवल 1", "उपरोक्त सभी", "इनमें से कोई नहीं", "केवल 1 और 3"]) {
    check(`Hindi closure excluded: "${t}"`, answerTextOf([hi("", t)], "A") === null);
  }
  check("a substantive Hindi answer is KEPT", answerTextOf([hi("", "फ़िरोज़ शाह तुग़लक़")], "A") !== null);
  check("English is preferred over Hindi when both exist", answerTextOf([hi("Firoz Shah Tughlaq", "फ़िरोज़ शाह तुग़लक़")], "A") === "firoz shah tughlaq");
}

// ---------------------------------------------------------------------------
// series-demand.ts's matchingLeaves — must agree with series/build.ts's
// buildAxis prefix rule verbatim, since one decides what topup GENERATES and
// the other decides what an assembled test DRAWS FROM.
// ---------------------------------------------------------------------------
{
  const leaf = (path: string) => ({ path });
  const leaves = [
    leaf("polity"),
    leaf("polity/constitution"),
    leaf("polity/constitution/amendments"),
    leaf("polity-extra"), // the exact false-positive the trailing-slash guard exists to stop
    leaf("economy"),
    leaf("economy/fiscal"),
  ];

  check("empty targets ([]) matches every leaf — the whole-paper (full_length) case", matchingLeaves(leaves, []).length === leaves.length);

  const exact = matchingLeaves(leaves, ["economy"]);
  check("a prefix matches ITSELF", exact.some((l) => l.path === "economy"));
  check("a prefix matches its DESCENDANTS", exact.some((l) => l.path === "economy/fiscal"));
  check("a prefix does not pull in an unrelated sibling", !exact.some((l) => l.path === "polity"));

  const constitution = matchingLeaves(leaves, ["polity/constitution"]);
  check("a depth-2 prefix matches only its own subtree, not the whole depth-1 section", constitution.length === 2);
  check("...specifically excludes the depth-1 parent itself", !constitution.some((l) => l.path === "polity"));

  const polityOnly = matchingLeaves(leaves, ["polity"]);
  check(
    "⚑ THE TRAILING-SLASH GUARD: \"polity\" must NOT also match \"polity-extra\" — string startsWith alone would",
    !polityOnly.some((l) => l.path === "polity-extra"),
  );
  check("...while still matching polity's real descendants", polityOnly.some((l) => l.path === "polity/constitution"));

  const union = matchingLeaves(leaves, ["polity/constitution", "economy"]);
  check("multiple targets union rather than intersect", union.length === 4); // constitution, its child, economy, economy/fiscal

  check("a target matching nothing returns empty, not everything", matchingLeaves(leaves, ["no-such-section"]).length === 0);

  // Negative control: prove the boundary check is actually load-bearing by
  // reverting to a naive `startsWith` with no trailing-slash guard, and
  // confirming it WOULD have wrongly pulled in "polity-extra".
  const naiveMatches = (p: string, t: string) => p === t || p.startsWith(t);
  check(
    "negative control — a naive startsWith (no trailing slash) DOES wrongly match polity-extra",
    naiveMatches("polity-extra", "polity"),
  );
}

// ---------------------------------------------------------------------------
// series-demand.ts's distributeByHotness — turns one entry's qgen count into
// a per-leaf demand map, proportional to recency-weighted PYQ hotness.
// ---------------------------------------------------------------------------
{
  check("count<=0 yields an empty map", distributeByHotness(0, new Map([["a", 5]])).size === 0);
  check("an empty hotness map yields an empty map", distributeByHotness(10, new Map()).size === 0);

  // Proportional split: "a" is 3x hotter than "b" (30 vs 10), so of 20
  // questions it should get roughly 3x as many.
  const prop = distributeByHotness(20, new Map([["a", 30], ["b", 10]]));
  check("hotter leaf gets a bigger share", (prop.get("a") ?? 0) > (prop.get("b") ?? 0));
  check("the split is close to the true 3:1 ratio (15 vs 5)", prop.get("a") === 15 && prop.get("b") === 5);

  // Equal split when every leaf is equally (un)weighted — the same
  // `maxHot<=0` fallback `topup.ts`'s scaledFloor uses.
  const equal = distributeByHotness(9, new Map([["a", 0], ["b", 0], ["c", 0]]));
  check("all-zero hotness splits equally rather than collapsing to one leaf", equal.get("a") === 3 && equal.get("b") === 3 && equal.get("c") === 3);

  // ⚑ A leaf with hotness=0 gets NOTHING once at least one sibling has real
  // hotness — this is deliberate (a genuinely never-asked topic inside a
  // section that IS asked about should not siphon demand from the hot one),
  // but it is easy to get backwards, so pin it explicitly.
  const skewed = distributeByHotness(10, new Map([["hot", 100], ["cold", 0]]));
  check("a zero-hotness leaf sharing a pool with a hot one gets excluded, not a token amount", !skewed.has("cold"));
  check("...and the hot leaf gets the full count", skewed.get("hot") === 10);

  // Negative control: proves the proportionality assertion actually
  // distinguishes correct from wrong — an EQUAL-split implementation applied
  // to this same non-uniform input would NOT reproduce 15/5.
  const wrongEqualSplit = new Map([["a", 10], ["b", 10]]); // what a bugged equal-split-always would produce for 20
  check("negative control — an equal-split bug would NOT match the real 15/5 proportional result", wrongEqualSplit.get("a") !== 15);

  // ⚑ THE ROUNDING-LOSS BUG (found by the 2026-08-22 edge-case audit): a plain
  // `Math.round` per leaf can silently lose the WHOLE count. 2 questions spread
  // across 9 equal-hotness leaves (a realistic CSAT-sized sectional entry) gives
  // every leaf a raw share of 2/9≈0.22, which rounds to 0 EVERYWHERE — the
  // entry's entire demand vanishes with no leaf ever asked for anything and no
  // error raised. Reproduced directly with the naive formula below before
  // asserting the real function does not repeat it.
  const naiveRound = (count: number, n: number) => Math.round(count * (1 / n));
  check("negative control — the naive per-leaf Math.round DOES lose small demand across many equal leaves", naiveRound(2, 9) === 0);

  const nineEqual = new Map(Array.from({ length: 9 }, (_, i) => [`leaf${i}`, 0] as const));
  const smallAcrossMany = distributeByHotness(2, nineEqual);
  const smallSum = [...smallAcrossMany.values()].reduce((s, v) => s + v, 0);
  check("the real function preserves a small count across many equal leaves instead of losing it", smallSum === 2);

  // Property check, not just one hand-picked case: for a spread of realistic
  // entry sizes and leaf-set shapes (including primes and odd counts that
  // cannot divide evenly), the allocated total must equal `count` exactly —
  // largest-remainder's whole point, verified rather than assumed.
  let allSumsExact = true;
  for (const [c, n] of [[1, 5], [2, 9], [3, 7], [5, 13], [7, 3], [15, 8], [30, 9], [100, 33]] as const) {
    const leaves = new Map(Array.from({ length: n }, (_, i) => [`l${i}`, i]));
    const total = [...distributeByHotness(c, leaves).values()].reduce((s, v) => s + v, 0);
    if (total !== c) allSumsExact = false;
  }
  check("largest-remainder sums to EXACTLY count across a spread of count/leaf-count shapes, incl. primes", allSumsExact);

  // The single-question case must go somewhere sensible, not vanish: with one
  // dominant leaf and several cold ones, the whole unit goes to the hot leaf.
  const one = distributeByHotness(1, new Map([["hot", 50], ["mild", 5], ["cold", 0]]));
  check("count=1 is not lost — it lands on the hottest leaf", one.get("hot") === 1 && !one.has("mild") && !one.has("cold"));
}

if (failures.length > 0) {
  console.error(`✗ qgen planner: ${failures.length} assertion(s) failed`);
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(1);
}
console.log(`✓ qgen planner: ${pass}/${pass} assertions passed`);
