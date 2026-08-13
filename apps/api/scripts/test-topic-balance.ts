/**
 * Pure unit tests for `lib/topic-balance.ts` — no DB, no clock, no model, no
 * randomness, so this is safe to run against any checkout at any time.
 *
 *   pnpm --filter api test:balance
 *
 * Every property the balancer promises is asserted here, including the two that
 * are easy to break by "simplifying" it: within-section order is preserved, and a
 * zero-weight section still appears via the coverage floor.
 */
import { balancedPick, maxSectionDeviationPct, type TopicItem } from "../src/lib/topic-balance.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** `n` items in section `top`, ids `top1..topN`. */
function items(top: string, n: number): TopicItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${top}${i + 1}`, top }));
}

function countsOf(picked: readonly TopicItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of picked) out[p.top] = (out[p.top] ?? 0) + 1;
  return out;
}

// --------------------------------------------------------------- proportionality
{
  // 4 sections, weights 40/30/20/10, ample supply, 100 slots → within 1 of target.
  const w: Record<string, number> = { a: 40, b: 30, c: 20, d: 10 };
  const pool = [...items("a", 100), ...items("b", 100), ...items("c", 100), ...items("d", 100)];
  const picked = balancedPick({ pool, count: 100, weightOf: (t) => w[t] ?? 0 });
  eq("proportional: takes exactly count", picked.length, 100);
  const c = countsOf(picked);
  for (const [top, weight] of Object.entries(w)) {
    check(`proportional: ${top} within 1 of target`, Math.abs((c[top] ?? 0) - weight) <= 1, `got ${c[top]} want ~${weight}`);
  }
  check("proportional: deviation under 1pp", maxSectionDeviationPct(picked, (t) => w[t] ?? 0, Object.keys(w)) < 1);
}

// ------------------------------------------------------------------ coverage floor
{
  // A zero-weight section must STILL appear — reweighting, not exclusion.
  const w: Record<string, number> = { big: 100, zero: 0 };
  const pool = [...items("big", 50), ...items("zero", 5)];
  const picked = balancedPick({ pool, count: 10, weightOf: (t) => w[t] ?? 0 });
  const c = countsOf(picked);
  check("floor: zero-weight section still appears", (c.zero ?? 0) >= 1, `got ${c.zero}`);
  check("floor: heavy section still dominates", (c.big ?? 0) >= 8, `got ${c.big}`);

  // minPerSection: 0 disables it.
  const none = balancedPick({ pool, count: 10, weightOf: (t) => w[t] ?? 0, minPerSection: 0 });
  eq("floor: minPerSection 0 excludes the zero-weight section", countsOf(none).zero, undefined as unknown as number);

  // A paper smaller than the section count spends its floor on the heaviest.
  const tiny = balancedPick({
    pool: [...items("hi", 5), ...items("mid", 5), ...items("lo", 5)],
    count: 2,
    weightOf: (t) => ({ hi: 10, mid: 5, lo: 1 })[t] ?? 0,
  });
  eq("floor: tiny paper picks heaviest sections first", tiny.map((p) => p.top), ["hi", "mid"]);
}

// ------------------------------------------------------------ within-section order
{
  // The caller's order inside a section is a real signal (CA relevance, weak-topic
  // priority). It must survive untouched.
  const pool = [...items("a", 5), ...items("b", 5)];
  const picked = balancedPick({ pool, count: 6, weightOf: () => 1 });
  const aOrder = picked.filter((p) => p.top === "a").map((p) => p.id);
  const bOrder = picked.filter((p) => p.top === "b").map((p) => p.id);
  eq("order: section a keeps caller order", aOrder, ["a1", "a2", "a3"]);
  eq("order: section b keeps caller order", bOrder, ["b1", "b2", "b3"]);
}

// ------------------------------------------------------------------- thin supply
{
  // A section that runs dry gives its slots to the next-most-deficient one, and
  // the paper still reaches `count`.
  const w: Record<string, number> = { a: 50, b: 50 };
  const pool = [...items("a", 2), ...items("b", 20)];
  const picked = balancedPick({ pool, count: 10, weightOf: (t) => w[t] ?? 0 });
  eq("thin: still reaches count", picked.length, 10);
  eq("thin: exhausted section contributes all it had", countsOf(picked).a, 2);

  // A pool smaller than count returns the whole pool, never a duplicate.
  const short = balancedPick({ pool: items("a", 3), count: 10, weightOf: () => 1 });
  eq("thin: short pool returns everything", short.length, 3);
  eq("thin: no duplicates", new Set(short.map((s) => s.id)).size, 3);
}

// ------------------------------------------------------------- cross-slice running
{
  // THE reason this module exists: two slices drawn from differently shaped pools
  // must compose into ONE balanced paper. Slice 1 can only offer section `a`;
  // slice 2 must therefore correct for it.
  const w: Record<string, number> = { a: 50, b: 50 };
  const running = new Map<string, number>();
  const s1 = balancedPick({ pool: items("a", 10), count: 6, weightOf: (t) => w[t] ?? 0, running, placedTotal: 0 });
  const s2 = balancedPick({
    pool: [...items("a", 10), ...items("b", 10)],
    count: 6,
    weightOf: (t) => w[t] ?? 0,
    running,
    placedTotal: s1.length,
  });
  const all = [...s1, ...s2];
  eq("cross-slice: total size", all.length, 12);
  const c = countsOf(all);
  check("cross-slice: second slice corrects the first's skew", (c.b ?? 0) >= 5, `b=${c.b} a=${c.a}`);
  check("cross-slice: whole-paper deviation is small", maxSectionDeviationPct(all, (t) => w[t] ?? 0, Object.keys(w)) <= 10);

  // Without the shared running counts the same two slices stay skewed — this is
  // the negative control for the mechanism itself.
  const naive = [
    ...balancedPick({ pool: items("a", 10), count: 6, weightOf: (t) => w[t] ?? 0 }),
    ...balancedPick({ pool: [...items("a", 10), ...items("b", 10)], count: 6, weightOf: (t) => w[t] ?? 0 }),
  ];
  check(
    "cross-slice: control — independent slices ARE skewed",
    maxSectionDeviationPct(naive, (t) => w[t] ?? 0, Object.keys(w)) > 10,
    `deviation ${maxSectionDeviationPct(naive, (t) => w[t] ?? 0, Object.keys(w)).toFixed(1)}pp`,
  );
}

// ------------------------------------------------------------ duplicate ids
{
  // THE daily quiz's real shape: its backfill reservoir is
  // [...random, ...pyq, ...generated, ...ca] and `random` is every catalog MCQ
  // for the paper, so it is a SUPERSET of the other three — the same question
  // appears two or three times. The caller stores picks in a Map keyed by id, so
  // an undeduped pick is not a visible duplicate: it is a silently SHORT paper.
  const random = [...items("a", 3), ...items("b", 3)];
  const pyq = [{ id: "a1", top: "a" }, { id: "b1", top: "b" }];
  const reservoir = [...random, ...pyq];
  for (const count of [4, 5, 6, 8]) {
    const picked = balancedPick({ pool: reservoir, count, weightOf: () => 1 });
    const ids = picked.map((p) => p.id);
    check(`dupes: count=${count} returns no duplicate id`, new Set(ids).size === ids.length, `[${ids.join(",")}]`);
  }
  eq("dupes: a duplicated pool yields at most its DISTINCT size", balancedPick({ pool: reservoir, count: 99, weightOf: () => 1 }).length, 6);
  // Excluding an id must drop EVERY copy of it, not just the first.
  const ex = balancedPick({ pool: reservoir, count: 99, weightOf: () => 1, exclude: new Set(["a1"]) });
  eq("dupes: exclude removes all copies", ex.filter((p) => p.id === "a1").length, 0);
  // And the section mix must still be right despite the duplication.
  const balanced = balancedPick({ pool: reservoir, count: 4, weightOf: () => 1 });
  eq("dupes: mix unaffected by duplication", countsOf(balanced), { a: 2, b: 2 });
}

// ----------------------------------------------------------------------- exclude
{
  const pool = [...items("a", 5), ...items("b", 5)];
  const picked = balancedPick({ pool, count: 10, weightOf: () => 1, exclude: new Set(["a1", "a2", "b1"]) });
  eq("exclude: excluded ids are absent", picked.filter((p) => ["a1", "a2", "b1"].includes(p.id)).length, 0);
  eq("exclude: returns the rest", picked.length, 7);
}

// -------------------------------------------------------------------- edge cases
{
  eq("edge: count 0", balancedPick({ pool: items("a", 5), count: 0, weightOf: () => 1 }).length, 0);
  eq("edge: negative count", balancedPick({ pool: items("a", 5), count: -3, weightOf: () => 1 }).length, 0);
  eq("edge: empty pool", balancedPick({ pool: [], count: 5, weightOf: () => 1 }).length, 0);
  eq("edge: all weights zero still fills via floor+topup", balancedPick({ pool: [...items("a", 3), ...items("b", 3)], count: 4, weightOf: () => 0 }).length, 4);
  eq("edge: everything excluded", balancedPick({ pool: items("a", 3), count: 3, weightOf: () => 1, exclude: new Set(["a1", "a2", "a3"]) }).length, 0);
  // Negative weights are clamped to 0 rather than inverting the ordering.
  const negPicked = balancedPick({ pool: [...items("a", 5), ...items("b", 5)], count: 6, weightOf: (t) => (t === "a" ? -10 : 10) });
  check("edge: negative weight clamped, not inverted", (countsOf(negPicked).b ?? 0) >= (countsOf(negPicked).a ?? 0), JSON.stringify(countsOf(negPicked)));
}

// ------------------------------------------------------------------ determinism
{
  const w: Record<string, number> = { a: 3, b: 2, c: 1 };
  const pool = [...items("a", 20), ...items("b", 20), ...items("c", 20)];
  const one = balancedPick({ pool, count: 15, weightOf: (t) => w[t] ?? 0 }).map((p) => p.id);
  const two = balancedPick({ pool, count: 15, weightOf: (t) => w[t] ?? 0 }).map((p) => p.id);
  eq("determinism: same input, same output", one, two);
}

// ------------------------------------------------------- maxSectionDeviationPct
{
  const w: Record<string, number> = { a: 50, b: 50 };
  eq("deviation: perfect split is 0", maxSectionDeviationPct([...items("a", 5), ...items("b", 5)], (t) => w[t] ?? 0, ["a", "b"]), 0);
  eq("deviation: all-one-section is 50pp", maxSectionDeviationPct(items("a", 10), (t) => w[t] ?? 0, ["a", "b"]), 50);
  eq("deviation: empty paper is 0", maxSectionDeviationPct([], (t) => w[t] ?? 0, ["a", "b"]), 0);
  // A section that is MISSING entirely must be caught, not silently ignored — the
  // daily quiz's real defect (Economic & Social Development scored 0 on a 15% target).
  check(
    "deviation: a missing target section is caught",
    maxSectionDeviationPct(items("a", 10), (t) => ({ a: 85, missing: 15 })[t] ?? 0, ["a", "missing"]) === 15,
  );
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
