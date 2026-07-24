/**
 * Sukoon crisis-detection RED-TEAM SUITE (blueprint F3) — run with
 *   pnpm --filter api test:crisis          # Layer 1 (keyword) — deterministic, CI
 *   pnpm --filter api test:crisis --live   # + Layer 2 (classifier) on euphemism cases
 *
 * The default (CI) pass exercises the PURE keyword detector: no DB, no model, no
 * env — so it runs anywhere and gates every PR. It asserts, for 100+ adversarial
 * code-mixed inputs, that the deterministic layer meets each case's `keywordFloor`
 * (a safety floor: may fire higher, never lower) and never exceeds `maxKeyword`
 * on the benign/negation/lookalike cases (the no-false-positive contract).
 *
 * The `--live` pass additionally sends the euphemism cases (which the keyword
 * layer legitimately can't catch) through the real claude-haiku-4-5 classifier
 * and asserts the COMBINED detection reaches `engineFloor`. It needs
 * ANTHROPIC_API_KEY and is never run in CI (model cost + non-determinism).
 *
 * Exits non-zero on any failure.
 */
import { crisisLevelRank, maxCrisisLevel } from "@neev/shared";
import { detectKeywordLevel } from "../src/sukoon/services/crisis/keywordDetector.js";
import { RED_TEAM_CASES, type RedTeamCase } from "../src/sukoon/services/crisis/red-team-cases.js";
// NOTE: the classifier (and its anthropic/supabase import graph) is imported
// LAZILY, only inside the --live block below — so the default CI run pulls in
// ONLY pure, env-free modules (keyword detector + shared + cases). This keeps
// the safety-critical CI gate immune to a future module-load side effect in the
// model/DB libs that would otherwise break it with no env present.

const live = process.argv.includes("--live");

interface Failure {
  id: string;
  category: string;
  detail: string;
}

const failures: Failure[] = [];
let ran = 0;
let skipped = 0;

function assertFloor(c: RedTeamCase, actual: string, floor: string, kind: string): void {
  if (crisisLevelRank(actual as never) < crisisLevelRank(floor as never)) {
    failures.push({
      id: c.id,
      category: c.category,
      detail: `${kind}: got "${actual}" but must be at least "${floor}"  — «${c.text}»`,
    });
  }
}

function assertCeiling(c: RedTeamCase, actual: string, ceiling: string, kind: string): void {
  if (crisisLevelRank(actual as never) > crisisLevelRank(ceiling as never)) {
    failures.push({
      id: c.id,
      category: c.category,
      detail: `${kind}: got "${actual}" but must not exceed "${ceiling}" (false positive)  — «${c.text}»`,
    });
  }
}

// --- Layer 1 (keyword) — the deterministic CI pass -------------------------
for (const c of RED_TEAM_CASES) {
  if (c.todo || !c.text.trim()) {
    skipped++;
    continue;
  }
  ran++;
  const { level } = detectKeywordLevel(c.text);
  assertFloor(c, level, c.keywordFloor, "keyword floor");
  if (c.maxKeyword !== undefined) assertCeiling(c, level, c.maxKeyword, "keyword ceiling");
}

console.log(
  `Layer 1 (keyword): ran ${ran} case(s), skipped ${skipped} TODO/empty, ` +
    `${ran - new Set(failures.map((f) => f.id)).size} passed.`,
);

// --- Layer 2 (classifier) — optional live pass -----------------------------
if (live) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("--live requires ANTHROPIC_API_KEY; aborting.");
    process.exit(1);
  }
  const { classifyMessage } = await import("../src/sukoon/services/crisis/classifier.js");
  const liveCases = RED_TEAM_CASES.filter((c) => !c.todo && c.text.trim() && c.engineFloor);
  console.log(`\nLayer 2 (classifier) live pass: ${liveCases.length} euphemism case(s)…`);
  for (const c of liveCases) {
    const keyword = detectKeywordLevel(c.text);
    const classifier = await classifyMessage(c.text);
    const combined = maxCrisisLevel(keyword.level, classifier.level);
    // engineFloor is guaranteed defined by the filter above.
    assertFloor(c, combined, c.engineFloor as string, "engine floor (live)");
    console.log(`  ${c.id}: keyword=${keyword.level} classifier=${classifier.level} → ${combined}`);
  }
}

// --- Report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} red-team assertion(s) FAILED:\n`);
  for (const f of failures) console.error(`  [${f.id}] (${f.category}) ${f.detail}`);
  process.exit(1);
}

console.log(`\n✓ crisis red-team suite passed (${ran} keyword case(s)${live ? " + live classifier pass" : ""}).`);
