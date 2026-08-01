/**
 * Unit tests for the shared CLI arg parser (`src/ingest/_shared.ts`) — run with
 *   pnpm --filter api test:args
 *
 * No DB / model / network deps, so this runs offline with no env. Exits
 * non-zero on any failed assertion.
 *
 * ⚑ WHY THIS FILE EXISTS, AND WHY IT IS PURE.
 * `parseArgs` is a SAFETY GUARD: it stands between a mistyped argv and a real,
 * billed, production-DB-writing pipeline run (docs/OUTSTANDING.md §0d — the
 * 2026-07-31 `ingest:syllabus` incident). The incident itself was caused by an
 * agent TESTING A GUARD by invoking the real pipeline in a shell loop. So this
 * harness never invokes a pipeline, never opens a connection and never spends a
 * token — it calls the pure parser directly with literal argv arrays. Keep it
 * that way: if verifying this parser ever seems to require running a real
 * script, that is the incident repeating itself.
 */
import assert from "node:assert/strict";
import { parseArgs, type FlagSpec } from "../src/ingest/_shared.js";

let passed = 0;

/** Assert an argv is REJECTED, optionally checking the message explains why. */
function rejects(label: string, argv: string[], spec: FlagSpec, mustMention?: string[]): void {
  let threw: Error | null = null;
  try {
    parseArgs(argv, spec, "test");
  } catch (err) {
    threw = err as Error;
  }
  assert.ok(threw, `${label}: expected a throw, but the argv was ACCEPTED`);
  for (const m of mustMention ?? []) {
    assert.ok(
      threw.message.toLowerCase().includes(m.toLowerCase()),
      `${label}: error message must mention "${m}".\n  Got: ${threw.message}`,
    );
  }
  passed++;
}

/** Assert an argv is ACCEPTED and parses to exactly `expected`. */
function accepts(
  label: string,
  argv: string[],
  spec: FlagSpec,
  expected: Record<string, string | boolean>,
): void {
  let result: Record<string, string | boolean>;
  try {
    result = parseArgs(argv, spec, "test");
  } catch (err) {
    assert.fail(`${label}: expected acceptance, but it threw:\n  ${(err as Error).message}`);
  }
  assert.deepEqual(result, expected, `${label}: parsed to the wrong shape`);
  passed++;
}

// A spec shaped like the real ingest:syllabus one — the script from the incident.
const SYLLABUS: FlagSpec = {
  value: ["exam", "paper"],
  boolean: ["dry-run"],
  positiveInt: ["limit-nodes"],
};

// ---------------------------------------------------------------------------
// (b) THE INCIDENT ITSELF — the single most important assertion in this file.
// zsh does not word-split an unquoted "$var", so several flags arrived as ONE
// argv token. The old parser read that as the nonsense key
// "exam upsc --dry-run": `args.exam` was undefined (NOT `true`, so a
// valueless-flag check could not see it) and `--dry-run` was swallowed, so the
// run proceeded against the DEFAULT exam and WROTE to the production DB.
// ---------------------------------------------------------------------------
rejects(
  "INCIDENT: collapsed multi-word token is rejected",
  ["--exam upsc --dry-run"],
  SYLLABUS,
  ["unrecognised", "whitespace"],
);
rejects(
  "INCIDENT: collapsed token names zsh as the cause",
  ["--exam upsc --dry-run"],
  SYLLABUS,
  ["zsh"],
);
rejects("INCIDENT variant: two flags collapsed, no value", ["--paper PRE_GS1"], SYLLABUS, ["whitespace"]);
// The incident shape must NOT be mistaken for a valueless-flag problem: prove
// the parser reports it as an UNKNOWN key, which is the only check that sees it.
rejects("INCIDENT: reported as unknown, not as valueless", ["--exam upsc --dry-run"], SYLLABUS, [
  "unrecognised flag",
]);

// ---------------------------------------------------------------------------
// (a) BARE POSITIONALS — invisible to the old parser entirely.
// ---------------------------------------------------------------------------
rejects("positional: `ingest:syllabus upsc` (forgot --exam)", ["upsc"], SYLLABUS, ["positional"]);
rejects("positional: after a valid flag pair", ["--exam", "uppsc", "stray"], SYLLABUS, ["positional"]);
rejects("positional: a lone value with no flag", ["PRE_GS1"], SYLLABUS, ["positional"]);

// ---------------------------------------------------------------------------
// (c) VALUELESS VALUE-FLAGS.
// ---------------------------------------------------------------------------
rejects("valueless: --exam followed by another flag", ["--exam", "--dry-run"], SYLLABUS, ["requiring a value"]);
rejects("valueless: --exam at end of argv", ["--exam"], SYLLABUS, ["requiring a value"]);
rejects("valueless: --limit-nodes at end of argv", ["--limit-nodes"], SYLLABUS, ["requiring a value"]);

// ---------------------------------------------------------------------------
// UNKNOWN FLAGS.
// ---------------------------------------------------------------------------
rejects("unknown: a typo'd flag", ["--exams", "uppsc"], SYLLABUS, ["unrecognised"]);
rejects("unknown: --key=value form with an unknown key", ["--nope=1"], SYLLABUS, ["unrecognised"]);
// A misparse must not be rescued just because other flags were fine.
rejects("unknown: rejected even alongside valid flags", ["--exam", "uppsc", "--bogus"], SYLLABUS, ["bogus"]);

// ---------------------------------------------------------------------------
// A BOOLEAN FLAG MUST NOT SWALLOW THE NEXT TOKEN.
// The old parser made `--dry-run PRE_GS1` set dry-run="PRE_GS1" (truthy, so it
// happened to work) while SILENTLY eating the operator's real argument. Now the
// boolean stays boolean and the orphan is caught as a positional.
// ---------------------------------------------------------------------------
rejects("boolean does not consume the next token", ["--dry-run", "PRE_GS1"], SYLLABUS, ["positional"]);
accepts("boolean followed by a real flag", ["--dry-run", "--exam", "uppsc"], SYLLABUS, {
  "dry-run": true,
  exam: "uppsc",
});
rejects("boolean given a value via =", ["--dry-run=false"], SYLLABUS, ["presence flag"]);

// ---------------------------------------------------------------------------
// NUMERIC VALIDATION — NaN and 0 are both FALSY, so an unvalidated bad value
// silently widens a capped run to the full one.
// ---------------------------------------------------------------------------
rejects("positiveInt: non-numeric", ["--limit-nodes", "abc"], SYLLABUS, ["positive integer"]);
rejects("positiveInt: zero", ["--limit-nodes", "0"], SYLLABUS, ["positive integer"]);
rejects("positiveInt: negative", ["--limit-nodes", "-3"], SYLLABUS, ["positive integer"]);
rejects("positiveInt: fractional", ["--limit-nodes", "2.5"], SYLLABUS, ["positive integer"]);
// Still rejected, but now by the EMPTY-value check, which runs before the
// numeric one — an empty value is a shape problem, not a range problem.
rejects("positiveInt: empty string via =", ["--limit-nodes="], SYLLABUS, ["EMPTY value"]);
accepts("positiveInt: a valid cap", ["--limit-nodes", "5"], SYLLABUS, { "limit-nodes": "5" });

const BUDGET: FlagSpec = { boolean: ["run"], positiveNumber: ["max-usd"] };
accepts("positiveNumber: fractional budget is LEGAL", ["--max-usd", "2.5"], BUDGET, { "max-usd": "2.5" });
rejects("positiveNumber: zero budget", ["--max-usd", "0"], BUDGET, ["positive number"]);
rejects("positiveNumber: non-numeric budget", ["--max-usd", "abc"], BUDGET, ["positive number"]);

// `--wait 0` is the CRON'S OWN VALUE ("submit the batch and exit without
// polling"). A strictly-positive validator here would break the scheduled run —
// this assertion is what stops someone "tightening" it later.
const WAIT: FlagSpec = { nonNegativeNumber: ["wait"] };
accepts("nonNegativeNumber: ZERO IS VALID (ca:run --wait 0, the cron value)", ["--wait", "0"], WAIT, {
  wait: "0",
});
accepts("nonNegativeNumber: fractional minutes", ["--wait", "0.5"], WAIT, { wait: "0.5" });
rejects("nonNegativeNumber: negative", ["--wait", "-1"], WAIT, [">= 0"]);
// Also still rejected — an empty value must never be read as a valid 0.
rejects("nonNegativeNumber: empty string is not a valid 0", ["--wait="], WAIT, ["EMPTY value"]);

// ---------------------------------------------------------------------------
// `--key=value` — under the old parser this became the nonsense key
// "exam=upsc", i.e. the same silent-misparse class as the incident.
// ---------------------------------------------------------------------------
accepts("--key=value is parsed correctly", ["--exam=uppsc"], SYLLABUS, { exam: "uppsc" });
accepts("--key=value with an = inside the value", ["--paper=A=B"], SYLLABUS, { paper: "A=B" });

// ---------------------------------------------------------------------------
// HAPPY PATHS + aggregation.
// ---------------------------------------------------------------------------
accepts("empty argv is valid", [], SYLLABUS, {});
accepts("a fully-specified run", ["--exam", "uppsc", "--paper", "PRE_GS1", "--dry-run"], SYLLABUS, {
  exam: "uppsc",
  paper: "PRE_GS1",
  "dry-run": true,
});
rejects("multiple problems are reported together", ["stray", "--bogus", "--exam"], SYLLABUS, [
  "positional",
  "unrecognised",
  "requiring a value",
]);

// ---------------------------------------------------------------------------
// SPEC-AUTHORING MISTAKES — these silently DISABLE the protection, so they must
// fail loudly at startup rather than at 2am.
// ---------------------------------------------------------------------------
rejects(
  "malformed spec: flag declared with leading dashes",
  ["--dry-run"],
  { boolean: ["--dry-run"] },
  ["malformed", "without the leading"],
);
rejects(
  "malformed spec: flag declared under two kinds",
  [],
  { value: ["paper"], boolean: ["paper"] },
  ["more than one kind"],
);
// `out["__proto__"] = v` on a plain object literal sets the PROTOTYPE, not an own
// property, so the value vanishes and the caller reads `undefined` — a value flag
// that silently disappears. Found by an edge-case audit; unreachable via argv
// (an undeclared `--__proto__` is rejected as unknown), so the spec is the one
// path that could reach it.
rejects("malformed spec: __proto__ as a flag name", [], { value: ["__proto__"] }, ["reserved"]);
rejects("malformed spec: constructor as a flag name", [], { value: ["constructor"] }, ["reserved"]);

// ---------------------------------------------------------------------------
// DUPLICATE FLAGS. The last occurrence used to win SILENTLY, so
// `--paper A --paper B` ran against B while the operator may have meant A —
// the same silent-wrong-scope class as the incident. Easy to hit when a pnpm
// script pre-supplies a flag (`qgen:topup` supplies `--topup`) and the caller
// adds their own.
// ---------------------------------------------------------------------------
rejects("duplicate value flag", ["--paper", "A", "--paper", "B"], SYLLABUS, ["more than once"]);
rejects("duplicate boolean flag", ["--dry-run", "--dry-run"], SYLLABUS, ["more than once"]);
rejects("duplicate across spaced + inline forms", ["--paper", "A", "--paper=B"], SYLLABUS, ["more than once"]);

// ---------------------------------------------------------------------------
// EMPTY VALUES. An empty string is NOT "not supplied" — it passes every
// `typeof x === "string"` check, so it reaches queries as "" and silently
// matches nothing, or slips past a `?? default` meant to catch an absent flag.
// Both spellings must be caught.
// ---------------------------------------------------------------------------
rejects("empty inline value", ["--paper="], SYLLABUS, ["EMPTY value"]);
rejects("empty spaced value", ["--paper", ""], SYLLABUS, ["EMPTY value"]);
accepts("a value containing '=' is NOT empty", ["--paper=A=B"], SYLLABUS, { paper: "A=B" });

// ---------------------------------------------------------------------------
// EVERY SHIPPED SPEC — proves each real script's documented invocation still
// parses after this change. A regression here means a live command broke.
// ---------------------------------------------------------------------------
const SHIPPED: { script: string; spec: FlagSpec; documented: string[][] }[] = [
  // ingest/
  { script: "ingest:syllabus", spec: SYLLABUS, documented: [["--exam", "uppsc", "--dry-run"]] },
  {
    script: "ingest:upsc-syllabus",
    spec: { value: ["paper", "write-artifact"], boolean: ["verify-only", "dry-run", "write"] },
    documented: [["--verify-only"], ["--write-artifact", "docs/upsc-syllabus-coverage.md"], ["--write"]],
  },
  { script: "ingest:pyq", spec: { value: ["id"] }, documented: [["--id", "uppsc_prelims_2024_gs1"]] },
  { script: "ingest:pyq:load", spec: { value: ["id"], boolean: ["all"] }, documented: [["--all"]] },
  {
    script: "ingest:resolve",
    spec: { value: ["id"], boolean: ["all", "force", "no-escalate"], positiveInt: ["concurrency"] },
    documented: [["--all", "--force"], ["--concurrency", "6"], ["--no-escalate"]],
  },
  {
    script: "ingest:hindi-overlay",
    spec: {
      value: ["paper", "chunks"],
      positiveInt: ["year"],
      positiveNumber: ["min-stem", "min-opt"],
      boolean: ["apply"],
    },
    documented: [["--paper", "PRE_GS1", "--year", "2024", "--chunks", "d", "--apply"]],
  },
  {
    script: "ingest:regate",
    spec: { value: ["paper"], boolean: ["apply", "publish-only"] },
    documented: [["--paper", "PRE_CSAT", "--publish-only", "--apply"]],
  },
  {
    script: "ingest:backfill-marks",
    spec: { value: ["paper"], boolean: ["apply", "normalize"] },
    documented: [["--paper", "PRE_GS1", "--apply"], ["--normalize"]],
  },
  {
    script: "ingest:explain",
    // `all` is a documented NO-OP (it means "no --paper/--year filter"). It must
    // stay admitted or `pnpm ingest:explain --dry-run --all` breaks.
    spec: { value: ["paper"], positiveInt: ["year", "limit"], boolean: ["dry-run", "force", "all"] },
    documented: [["--dry-run", "--all"], ["--paper", "PRE_GS1", "--year", "2024", "--limit", "50"]],
  },
  {
    script: "ingest:assemble",
    spec: { value: ["id", "raw", "keyjson"] },
    documented: [["--id", "x", "--raw", "r.json", "--keyjson", "k.json"]],
  },
  {
    script: "ingest:embed",
    spec: { value: ["only"], positiveInt: ["limit"], boolean: ["missing-only"] },
    // `--missing-only` is the LIVE nightly cron invocation
    // (.github/workflows/nightly-settle.yml). If this assertion ever fails, the
    // nightly embedding backfill is broken.
    documented: [["--missing-only"], ["--only", "syllabus", "--limit", "500"]],
  },
  {
    script: "ingest:align-key",
    spec: { value: ["raw", "key", "out"] },
    documented: [["--raw", "r.json", "--key", "k.json", "--out", "o.json"]],
  },
  // ca/
  {
    script: "ca:run",
    spec: {
      value: ["mode"],
      positiveNumber: ["days"],
      positiveInt: ["max-per-source", "max-total"],
      nonNegativeNumber: ["wait"],
    },
    documented: [["--days", "3"], ["--mode", "sync"], ["--wait", "0"], ["--max-per-source", "15", "--max-total", "40"]],
  },
  { script: "ca:assemble", spec: { positiveNumber: ["days"] }, documented: [["--days", "7"]] },
  {
    script: "ca:backfill",
    spec: { boolean: ["run"], positiveNumber: ["max-usd"] },
    documented: [["--run", "--max-usd", "5"], []],
  },
  {
    script: "ca:deepdive",
    spec: { value: ["month"], boolean: ["run"] },
    documented: [["--month", "2026-07", "--run"]],
  },
  {
    script: "ca:verify-mcqs",
    spec: { boolean: ["run"], positiveNumber: ["max-usd"] },
    // The LIVE cron invocation (.github/workflows/ca-verify-mcqs.yml).
    documented: [["--run"], ["--run", "--max-usd", "2.5"]],
  },
  // qgen/cli.ts — converted FROM a private clone of the old unsafe parser. It was
  // the worst instance in the repo: one collapsed token defeated `--max-usd` AND
  // `--dry-run` together, turning a capped dry run into a real billed generation
  // run that writes `questions` rows. `--topup` is PRE-SUPPLIED by the
  // `qgen:topup` pnpm script, so dropping it from the spec breaks that entry point.
  {
    script: "qgen",
    spec: {
      value: ["node", "kind", "difficulty"],
      boolean: ["topup", "batch", "dry-run"],
      positiveInt: ["count"],
      positiveNumber: ["max-usd"],
    },
    documented: [
      ["--topup"], // exactly what `pnpm qgen:topup` supplies
      ["--topup", "--max-usd", "2.5", "--dry-run"],
      ["--node", "PRE_GS1", "--kind", "mcq", "--count", "10", "--batch"],
      ["--difficulty", "3:5:2"], // NOT a number — positiveInt would wrongly reject it
    ],
  },

  // ---- CLIs converted FROM private parsers (dialects 2-6) ------------------
  // Each of these previously had its own hand-rolled parser. They are listed
  // here so the repo's single dialect stays regression-locked end to end.
  {
    // DESTRUCTIVE: 16-table + users_profile deletes. `--dry-run` defaults FALSE,
    // and its old parser let a valueless `--to` eat the `--dry-run` that follows.
    script: "migrate:dev-user",
    spec: { value: ["to", "from", "email"], boolean: ["dry-run"] },
    documented: [["--to", "u", "--dry-run"], ["--email", "a@b.com", "--from", "x"]],
  },
  {
    // DESTRUCTIVE: wipes 26 table/column pairs for one account. Its old parser
    // did `argv[++i] ?? args.email`, silently retargeting the wipe at the DEFAULT
    // demo account when the address was omitted or swallowed.
    script: "demo:seed",
    spec: { value: ["email"], boolean: ["reset"] },
    documented: [["--reset"], ["--email", "demo@neevstudy.com", "--reset"]],
  },
  {
    // A valueless `--top` widened 3 -> 15 real web-research + author runs, with
    // no confirmation prompt anywhere in the file.
    script: "notes:gen",
    spec: { value: ["node", "paper"], boolean: ["no-web", "regen"], positiveInt: ["top"] },
    documented: [["--paper", "PRE_GS1", "--top", "3"], ["--node", "abc", "--no-web", "--regen"]],
  },
  {
    // `--regen` is READ but was undocumented in the usage string — omitting it
    // from the spec would have broken a live invocation.
    script: "notes:chapter",
    spec: { value: ["node", "paper"], boolean: ["no-web", "regen", "yes"], positiveInt: ["top"] },
    documented: [["--paper", "PRE_GS1", "--top", "3", "--yes"], ["--node", "abc", "--regen"]],
  },
  {
    script: "notes:chapter:context",
    spec: { value: ["node", "out", "dir"], positiveInt: ["top"] },
    documented: [["--node", "PRE_GS1", "--top", "15", "--dir", "d"], ["--node", "abc", "--out", "o.json"]],
  },
  {
    script: "notes:chapter:assemble",
    spec: { value: ["file", "dir"] },
    documented: [["--file", "c.json"], ["--dir", "d"]],
  },
  {
    // Its old call site SPREAD the parsed object into DailyBuildOptions, so the
    // raw key `user` would silently not become `userId` — fanning the build out
    // to every onboarded user. `--size` is positiveInt because `?? default` does
    // NOT catch NaN downstream.
    script: "daily:build",
    spec: { value: ["date", "user"], positiveInt: ["size"] },
    documented: [[], ["--date", "2026-07-01"], ["--size", "25", "--user", "u"]],
  },
  {
    // 7 flags, not the 4 its first-line usage suggests. `--max-usd` is a DOLLAR
    // budget: positiveInt would wrongly reject `--max-usd 2.5`.
    script: "audit:resolve",
    spec: {
      value: ["run-id", "out"],
      boolean: ["hide", "all"],
      positiveInt: ["sample", "max-escalations"],
      positiveNumber: ["max-usd"],
    },
    documented: [
      ["--all", "--hide"],
      ["--sample", "200", "--run-id", "resolve-1"],
      ["--max-usd", "2.5", "--max-escalations", "80", "--out", "o.json"],
    ],
  },
  {
    // `--limit` is consumed as `if (limit)`, so BOTH failure shapes (undefined
    // and NaN) read as "no limit" — silently widening to the full bank.
    script: "audit:consistency",
    spec: { value: ["run-id", "out"], boolean: ["hide"], positiveInt: ["limit"] },
    documented: [["--limit", "50"], ["--run-id", "consistency-1", "--hide", "--out", "o.json"]],
  },
  {
    // DELETES auth users. `--days --apply` used to yield apply=true AND
    // retentionDays=NaN at once, failing safe only by accident (an unrelated
    // `new Date(NaN).toISOString()` RangeError downstream).
    script: "guests:prune",
    spec: { boolean: ["apply"], positiveInt: ["days"] },
    documented: [[], ["--apply"], ["--days", "30", "--apply"]],
  },
  {
    script: "cost:report",
    spec: { positiveInt: ["days"] },
    documented: [[], ["--days", "30"]],
  },
  {
    // ⚑ `--days 0` is MEANINGFUL here ("everyone", per the file's own comment),
    // which is why this is nonNegativeNumber and NOT positiveInt. The `--days 0`
    // case below is the assertion that stops someone "tightening" it later.
    script: "feature-discovery:report",
    spec: { nonNegativeNumber: ["days"] },
    documented: [[], ["--days", "7"], ["--days", "0"]],
  },
  {
    // A password may legitimately begin with `--`; the `--password=<value>` form
    // handles that unambiguously and is documented in the script.
    script: "set-password",
    spec: { value: ["email", "password"] },
    documented: [["--email", "a@b.com", "--password", "hunter2hunter2"], ["--password=--dashy-pass"]],
  },
  {
    script: "eval:answers",
    spec: { value: ["lang", "email"], boolean: ["keep"], positiveInt: ["runs"] },
    documented: [[], ["--runs", "2", "--lang", "hi"], ["--keep", "--email", "a@b.com"]],
  },

  // ---- CLIs converted FROM direct process.argv sniffing --------------------
  // These read flags straight off `process.argv` (`.includes("--apply")`,
  // `indexOf`+`[i+1]`, or `.find(a => a.startsWith("--kinds="))`). The `--apply`
  // ones failed SAFE, but each was still a separate dialect; consolidating them
  // is what lets `pnpm check:cli-args` enforce a single parser repo-wide.
  { script: "ca:distribute-mcqs", spec: { boolean: ["apply"] }, documented: [[], ["--apply"]] },
  { script: "ca:flag-mcqs", spec: { boolean: ["apply"] }, documented: [[], ["--apply"]] },
  { script: "ca:reclassify-mcq-nodes", spec: { boolean: ["apply"] }, documented: [[], ["--apply"]] },
  { script: "ca:remap-prelims", spec: { boolean: ["apply"] }, documented: [[], ["--apply"]] },
  {
    script: "prove-chapter-retrieval",
    spec: { value: ["node", "q", "locale"] },
    documented: [["--node", "abc"], ["--q", "what is federalism", "--locale", "en"]],
  },
  {
    // `--kinds` was historically ONLY accepted in the `--kinds=a,b` form. The
    // shared parser accepts both, so BOTH are asserted here.
    script: "tests:resync-marks",
    spec: { boolean: ["apply"], value: ["kinds"] },
    documented: [[], ["--apply"], ["--kinds=mock,sectional"], ["--kinds", "mock,sectional", "--apply"]],
  },
  {
    script: "trial-abuse:report",
    spec: { positiveInt: ["days", "window-hours", "min-accounts"] },
    documented: [[], ["--days", "7"], ["--window-hours", "24", "--min-accounts", "3"]],
  },
  { script: "ca:compile", spec: { value: ["month", "exam"] }, documented: [["--month", "2026-07"], ["--exam", "uppsc"]] },
  {
    // The prompt-regression harness itself. `--write` rewrites the committed
    // baseline, so it must stay a plain boolean that defaults to off.
    script: "prompts:snapshot",
    spec: { boolean: ["write"] },
    documented: [[], ["--write"]],
  },
];

for (const { script, spec, documented } of SHIPPED) {
  for (const argv of documented) {
    let ok = true;
    let msg = "";
    try {
      parseArgs(argv, spec, script);
    } catch (err) {
      ok = false;
      msg = (err as Error).message;
    }
    assert.ok(ok, `SHIPPED ${script}: documented invocation \`${argv.join(" ")}\` was REJECTED:\n  ${msg}`);
    passed++;
  }
  // Every shipped script must reject a bare positional and the incident shape.
  rejects(`SHIPPED ${script}: rejects a bare positional`, ["stray"], spec, ["positional"]);
  rejects(`SHIPPED ${script}: rejects a collapsed token`, ["--a b --c"], spec, ["unrecognised"]);
}

console.log(`✓ parseArgs guards: ${passed}/${passed} assertions passed`);
