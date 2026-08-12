/**
 * Pure regression test for the CA source rotation (`ca/source-rotation.ts`).
 *
 * `pnpm --filter api test:ca-rotation`. No DB, no network, no model, no clock —
 * same convention as `test:mentor` / `test:tips`. The point is that the FAIRNESS
 * property is asserted directly rather than argued: the defect this replaced was
 * invisible in every unit of the pipeline except the shape of the corpus after
 * weeks of runs, so it needs a test that fails if array order ever reasserts
 * itself.
 */
import { interleaveBySource } from "../src/ca/source-rotation.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- the property that matters ---------------------------------------------
// Three sources with plenty of items and a budget of 6: every source must get
// two. Under the old array-order walk the first source would have taken all 6.
{
  const a = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const b = ["b1", "b2", "b3", "b4", "b5", "b6"];
  const c = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const order = interleaveBySource([a, b, c]);
  const firstSix = order.slice(0, 6);
  const bySource = [0, 1, 2].map((i) => firstSix.filter((x) => x.sourceIndex === i).length);
  check("budget of 6 across 3 full sources is split 2/2/2", JSON.stringify(bySource) === "[2,2,2]", JSON.stringify(bySource));
  check(
    "round 0 is one item from each source, in configured order",
    order.slice(0, 3).map((x) => x.item).join(",") === "a1,b1,c1",
    order.slice(0, 3).map((x) => x.item).join(","),
  );
}

// --- the real shipped shape -------------------------------------------------
// 11 sources, 40-item budget, 15 per source: the newly added desks must be
// reached. This is the exact case the old loop failed — sources 4..11 got zero.
{
  const eleven = Array.from({ length: 11 }, (_, s) => Array.from({ length: 60 }, (_, i) => `s${s}i${i}`));
  const order = interleaveBySource(eleven);
  const budget = order.slice(0, 40);
  const reached = new Set(budget.map((x) => x.sourceIndex));
  check("all 11 sources are reached within a 40-item budget", reached.size === 11, `reached ${reached.size}`);
  const counts = Array.from({ length: 11 }, (_, i) => budget.filter((x) => x.sourceIndex === i).length);
  check("no source takes more than 4 of the 40", Math.max(...counts) <= 4, JSON.stringify(counts));
  check("every source takes at least 3 of the 40", Math.min(...counts) >= 3, JSON.stringify(counts));
}

// --- a thin source must not waste the budget --------------------------------
{
  const order = interleaveBySource([["a1"], ["b1", "b2", "b3"], ["c1", "c2", "c3"]]);
  check("thin source contributes its one item then drops out", order.filter((x) => x.sourceIndex === 0).length === 1);
  check(
    "remaining rounds go to the sources that still have items",
    order.slice(3).every((x) => x.sourceIndex !== 0),
  );
  check("total is conserved (1+3+3)", order.length === 7, String(order.length));
}

// --- conservation: nothing dropped, nothing duplicated ----------------------
{
  const src = [
    ["a1", "a2", "a3"],
    [] as string[],
    ["c1"],
    ["d1", "d2"],
  ];
  const order = interleaveBySource(src);
  const flat = order.map((x) => x.item).sort();
  const expected = src.flat().sort();
  check("every input item appears exactly once", JSON.stringify(flat) === JSON.stringify(expected), JSON.stringify(flat));
  check("an empty source is skipped without error", order.every((x) => x.sourceIndex !== 1));
  check(
    "each item is tagged with the source it came from",
    order.every((x) => src[x.sourceIndex].includes(x.item)),
  );
}

// --- a generic T may legitimately BE undefined -------------------------------
// Regression guard for the audit find: the first cut skipped on
// `item !== undefined`, which silently dropped such an element and broke the
// "every input item appears exactly once" guarantee for a generic caller.
{
  const src: (string | undefined)[][] = [["a1", undefined, "a3"], ["b1", "b2"]];
  const order = interleaveBySource(src);
  check("undefined elements are preserved, not dropped", order.length === 5, `got ${order.length}`);
  check(
    "the undefined lands in the right round and source",
    order.some((r) => r.sourceIndex === 0 && r.item === undefined),
  );
  check("an all-undefined source still contributes its slots", interleaveBySource([[undefined, undefined]]).length === 2);
}

// --- degenerate inputs ------------------------------------------------------
{
  check("no sources -> empty", interleaveBySource([]).length === 0);
  check("all sources empty -> empty", interleaveBySource([[], [], []]).length === 0);
  check("single source is passed through in order", interleaveBySource([["x", "y", "z"]]).map((r) => r.item).join(",") === "x,y,z");
}

console.log(`\nca source rotation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
