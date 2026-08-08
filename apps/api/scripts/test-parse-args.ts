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
  {
    // `--purge-orphans` DELETES embedding rows. `--show 0` ("print no sample
    // ids") is a real invocation, which is why `show` is nonNegativeNumber and
    // not positiveInt.
    script: "ingest:embed:verify",
    spec: { boolean: ["strict", "purge-orphans"], nonNegativeNumber: ["show"] },
    documented: [[], ["--strict"], ["--show", "10"], ["--show", "0"], ["--purge-orphans", "--strict"]],
  },
  // ca/
  {
    script: "ca:run",
    spec: {
      // `exam` is the content-targeting override (build for a NOT-YET-LIVE exam
      // without flipping `exams.is_live`). A `value` flag, so a valueless
      // `--exam` is rejected rather than collapsing to boolean `true` and
      // silently falling back to the live set.
      value: ["mode", "exam"],
      positiveNumber: ["days"],
      positiveInt: ["max-per-source", "max-total"],
      nonNegativeNumber: ["wait"],
    },
    documented: [
      ["--days", "3"],
      ["--mode", "sync"],
      ["--wait", "0"],
      ["--max-per-source", "15", "--max-total", "40"],
      ["--exam", "upsc"],
      ["--exam", "upsc", "--days", "3", "--wait", "0"],
    ],
  },
  {
    // Same `--exam` override as ca:run: omitted means every LIVE exam (what the
    // weekly cron does), and a valueless `--exam` must not collapse into "all".
    script: "ca:assemble",
    spec: { positiveNumber: ["days"], value: ["exam"] },
    documented: [["--days", "7"], ["--exam", "upsc"], ["--exam", "upsc", "--days", "7"]],
  },
  {
    script: "ca:backfill",
    // Same `--exam` override as ca:run. On THIS tool a valueless `--exam` would
    // be a data-loss shape (it rewrites exam_codes/syllabus_node_ids), so the
    // `value` kind is load-bearing, not cosmetic.
    spec: { boolean: ["run"], value: ["exam"], positiveNumber: ["max-usd"] },
    documented: [["--run", "--max-usd", "5"], [], ["--exam", "upsc"], ["--exam", "upsc", "--run", "--max-usd", "0.5"]],
  },
  {
    // The ADDITIVE sibling of ca:backfill (M48). Three kinds are load-bearing
    // here and none is cosmetic: `--exam` is `value` because it is REQUIRED and
    // a valueless one collapsing to `true` would be read as "no override" and
    // silently widen by the LIVE exam instead of the named one; `--apply` is the
    // write opt-in, so a lost `--apply` must fail closed to a dry run (it does —
    // the default IS dry run) and a stray `--apply true` must be rejected rather
    // than parsed; `--max-usd` is `positiveNumber` because it is a DOLLAR cap,
    // and `--limit` is `positiveInt` because a NaN sample size would widen the
    // run to the whole 2,104-item corpus.
    script: "ca:widen-exam",
    spec: { boolean: ["apply", "dry-run"], value: ["exam"], positiveInt: ["limit"], positiveNumber: ["max-usd"] },
    documented: [
      ["--exam", "upsc"],
      ["--exam", "upsc", "--dry-run"],
      ["--exam", "upsc", "--limit", "5"],
      ["--exam", "upsc", "--apply", "--max-usd", "8"],
    ],
  },
  {
    script: "ca:deepdive",
    spec: { value: ["month"], boolean: ["run", "previous"] },
    // `--previous --run` is the LIVE cron invocation (.github/workflows/ca-deepdive.yml).
    documented: [["--month", "2026-07", "--run"], ["--previous", "--run"], ["--previous"]],
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
      value: ["node", "kind", "difficulty", "exam"],
      boolean: ["topup", "batch", "dry-run"],
      positiveInt: ["count"],
      positiveNumber: ["max-usd"],
    },
    documented: [
      ["--topup"], // exactly what `pnpm qgen:topup` supplies
      ["--topup", "--max-usd", "2.5", "--dry-run"],
      // Topup-only exam override. Omitted, the planner runs for every LIVE exam;
      // named, for exactly that one (which may deliberately be a NON-live exam,
      // to stock its bank before launch). The CLI validates the code against the
      // registry because `getExamConfig` falls back to the default on a typo
      // instead of throwing.
      ["--topup", "--exam", "upsc", "--dry-run"],
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
    // Read-only report; `--out` OVERWRITES a git-tracked generated doc, so a
    // collapsed/valueless `--out` must be refused rather than silently writing
    // somewhere unintended. `--exam` has no default on purpose: a defaulted one
    // would let a caller regenerate the wrong exam's file without noticing.
    script: "notes:coverage",
    spec: { value: ["exam", "out"], boolean: ["json"] },
    documented: [["--exam", "upsc"], ["--exam", "upsc", "--out", "docs/upsc-chapter-coverage.md"], ["--exam", "uppsc", "--json"]],
  },
  {
    // Every flag is `value` and NONE has a default. `--stage` decides whether
    // the run is read-only (`scope`, `verify`) or WRITES production rows
    // (`assemble`, `resolve`, `publish`, `embed`), so a collapsed or valueless
    // `--stage` must be refused rather than fall through to some default —
    // the 2026-07-31 incident (§0d) was exactly a swallowed flag turning a
    // dry run into a real one. `--nodes`/`--exam` are required in code for the
    // same reason: a defaulted exam would embed-verify against the wrong one.
    // `--facts` is deliberately per-node (`node:factId,factId;…`) because there
    // is no resolve-all — blanket-resolving to force a publish defeats the gate.
    script: "notes:chapter:checkpoint",
    spec: { value: ["stage", "exam", "dir", "nodes", "facts", "terms"] },
    documented: [
      ["--stage", "scope", "--exam", "upsc", "--nodes", "abc", "--terms", "quit india,1947"],
      ["--stage", "assemble", "--exam", "upsc", "--dir", "/tmp/out", "--nodes", "abc,def"],
      ["--stage", "resolve", "--exam", "upsc", "--nodes", "abc", "--facts", "abc:f0,f1"],
      ["--stage", "publish", "--exam", "upsc", "--nodes", "abc"],
      ["--stage", "embed", "--exam", "upsc", "--nodes", "abc"],
      ["--stage", "verify", "--exam", "upsc", "--nodes", "abc"],
    ],
  },
  {
    // Its old call site SPREAD the parsed object into DailyBuildOptions, so the
    // raw key `user` would silently not become `userId` — fanning the build out
    // to every onboarded user. `--size` is positiveInt because `?? default` does
    // NOT catch NaN downstream.
    // `--exam` is the multi-exam override (default = every live exam), modelled
    // on qgen:topup's. A bare run is the 5:00 AM cron's own invocation and MUST
    // keep parsing.
    script: "daily:build",
    spec: { value: ["date", "user", "exam"], positiveInt: ["size"] },
    documented: [[], ["--date", "2026-07-01"], ["--size", "25", "--user", "u"], ["--exam", "upsc"]],
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
  {
    // Written on the shared parser from the start, but locked here like every
    // other CLI: `--snapshot` is a `value` flag on purpose, so a valueless
    // `--snapshot` is REFUSED rather than collapsing to boolean `true` — which
    // would make the tool skip its own pre-image write and then modify live
    // production rows with no restore path (D12/§0d, the exact shape that
    // caused the 2026-07-31 incident).
    script: "ca:strip-foreign-nodes",
    spec: { boolean: ["apply"], value: ["snapshot"] },
    documented: [[], ["--apply", "--snapshot", "/tmp/pre.json"]],
  },
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

  // ---- CLIs the ALIAS HOLE hid until 2026-08-01 ---------------------------
  // These four bound `process.argv.slice(2)` to a local and then read flags off
  // the local, which `scripts/check-cli-args.mjs` could not see — so they were
  // reported as protected while still on a hand-rolled dialect. See §0d.
  {
    // ⚑ The widest blast radius of the four: absent `--user` this recomputes
    // node_mastery for EVERY user (same Supabase project for dev AND prod).
    script: "mastery:build",
    spec: { value: ["user"] },
    documented: [[], ["--user", "00000000-0000-4000-8000-000000000001"]],
  },
  {
    script: "ca:embed",
    spec: { boolean: ["all"], positiveInt: ["limit"] },
    documented: [[], ["--all"], ["--limit", "50"], ["--all", "--limit", "50"]],
  },
  {
    script: "notes:embed",
    // `--missing-only` is the LIVE nightly cron invocation
    // (.github/workflows/nightly-settle.yml), same as ingest:embed above.
    spec: { value: ["node"], boolean: ["missing-only"], positiveInt: ["limit"] },
    documented: [[], ["--missing-only"], ["--node", "abc"], ["--limit", "10", "--node", "abc"]],
  },
  {
    // The prompt-regression harness itself. `--write` rewrites the committed
    // baseline, so it must stay a plain boolean that defaults to off.
    script: "prompts:snapshot",
    spec: { boolean: ["write"] },
    documented: [[], ["--write"]],
  },
  {
    // Both mock builders share one spec (src/mocks/exams.ts MOCK_BUILD_FLAGS)
    // because .github/workflows/mocks-build.yml runs them back to back as one
    // workflow — a policy that drifted between them would rebuild the two
    // stages for different exam sets. A BARE run is that workflow's own
    // invocation (default = live exams) and MUST keep parsing.
    script: "mocks:build",
    spec: { value: ["exam"] },
    documented: [[], ["--exam", "upsc"]],
  },
  {
    script: "mocks:build:mains",
    spec: { value: ["exam"] },
    documented: [[], ["--exam", "upsc"]],
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

// ---------------------------------------------------------------------------
// THE ALIAS-HOLE FOUR — the specific silent-widening branch each one had.
//
// `scripts/check-cli-args.mjs` reported these as protected because they bound
// `process.argv.slice(2)` to a local first, which every one of its regexes
// (anchored on the literal `process.argv`) went blind to. Each assertion below
// names the branch the old parser fell into, so a future migration back to a
// hand-rolled loop fails here rather than in production.
//
// PURE, like the rest of this file: the parser is called directly with literal
// argv arrays. `mastery:build` and `notes:embed` WRITE to the DB, so nothing
// here may ever invoke them (the incident was caused by testing a guard by
// running the real pipeline).
// ---------------------------------------------------------------------------
const MASTERY: FlagSpec = { value: ["user"] };
const CA_EMBED: FlagSpec = { boolean: ["all"], positiveInt: ["limit"] };
const EMBED_VERIFY: FlagSpec = { boolean: ["strict", "purge-orphans"], nonNegativeNumber: ["show"] };
const NOTES_EMBED: FlagSpec = { value: ["node"], boolean: ["missing-only"], positiveInt: ["limit"] };

// mastery:build — a collapsed or valueless --user left `userArg` undefined, and
// the very next line is `userArg ? [userArg] : await listAllUserIds()`: a
// one-user backfill silently became an ALL-USERS write.
rejects("ALIAS mastery:build: collapsed --user token", ["--user 00000000-0000-4000-8000-000000000001"], MASTERY, [
  "unrecognised",
  "whitespace",
]);
rejects("ALIAS mastery:build: valueless --user", ["--user"], MASTERY, ["value"]);
rejects("ALIAS mastery:build: bare uuid positional", ["00000000-0000-4000-8000-000000000001"], MASTERY, ["positional"]);
accepts("ALIAS mastery:build: scoped run still parses", ["--user", "u-1"], MASTERY, { user: "u-1" });

// ca:embed — `Math.max(0, Number(argv[i+1]) || 0)` mapped a bad --limit to 0,
// and `items.slice(0, 0)` is an EMPTY run reported as a successful backfill.
rejects("ALIAS ca:embed: non-numeric --limit is no longer 0", ["--limit", "abc"], CA_EMBED, ["positive integer"]);
rejects("ALIAS ca:embed: --limit 0 is no longer a silent no-op", ["--limit", "0"], CA_EMBED, ["positive integer"]);
rejects("ALIAS ca:embed: collapsed token", ["--all --limit 50"], CA_EMBED, ["unrecognised", "whitespace"]);
rejects("ALIAS ca:embed: valueless --limit", ["--limit", "--all"], CA_EMBED, ["value"]);
accepts("ALIAS ca:embed: capped run still parses", ["--all", "--limit", "50"], CA_EMBED, { all: true, limit: "50" });

// ingest:embed:verify — --purge-orphans DELETES rows, so it must never be
// reachable by accident; --show 0 must stay legal (it is documented).
rejects("ALIAS embed:verify: collapsed token hiding --purge-orphans", ["--strict --purge-orphans"], EMBED_VERIFY, [
  "unrecognised",
  "whitespace",
]);
rejects("ALIAS embed:verify: non-numeric --show is no longer 0", ["--show", "abc"], EMBED_VERIFY, ["number >= 0"]);
rejects("ALIAS embed:verify: --purge-orphans given a value", ["--purge-orphans=false"], EMBED_VERIFY, ["boolean"]);
accepts("ALIAS embed:verify: --show 0 stays legal", ["--show", "0"], EMBED_VERIFY, { show: "0" });
accepts("ALIAS embed:verify: destructive run still parses", ["--purge-orphans"], EMBED_VERIFY, {
  "purge-orphans": true,
});

// notes:embed — a valueless --node became undefined, WIDENING a one-node
// re-embed to every published note; a bad --limit became NaN, and
// `slice(0, NaN)` is `slice(0, 0)` — an empty run reported as success.
rejects("ALIAS notes:embed: valueless --node widened to all notes", ["--node", "--missing-only"], NOTES_EMBED, ["value"]);
rejects("ALIAS notes:embed: collapsed token", ["--node abc --limit 10"], NOTES_EMBED, ["unrecognised", "whitespace"]);
rejects("ALIAS notes:embed: NaN --limit is no longer slice(0,0)", ["--limit", "abc"], NOTES_EMBED, ["positive integer"]);
accepts("ALIAS notes:embed: nightly cron invocation still parses", ["--missing-only"], NOTES_EMBED, {
  "missing-only": true,
});
accepts("ALIAS notes:embed: scoped re-embed still parses", ["--node", "n-1", "--limit", "10"], NOTES_EMBED, {
  node: "n-1",
  limit: "10",
});

// ---------------------------------------------------------------------------
// ca:run / ca:backfill --exam — THE CONTENT-TARGETING OVERRIDE.
//
// This flag is what lets a run build for a NOT-YET-LIVE exam without flipping
// `exams.is_live` (which would also make that exam user-selectable — U7). Its
// failure mode is the one this whole parser exists to stop: if a malformed
// `--exam` yields no key, `resolveTargetExams` sees `undefined` and SILENTLY
// falls back to the LIVE set. On `ca:run` that spends against the wrong exam;
// on `ca:backfill`, which REWRITES `exam_codes` and `syllabus_node_ids` rather
// than adding to them, it is a data-loss shape. Hence `value`, not `boolean`.
// ---------------------------------------------------------------------------
const CA_RUN: FlagSpec = {
  value: ["mode", "exam"],
  positiveNumber: ["days"],
  positiveInt: ["max-per-source", "max-total"],
  nonNegativeNumber: ["wait"],
};
const CA_BACKFILL: FlagSpec = { boolean: ["run"], value: ["exam"], positiveNumber: ["max-usd"] };

rejects("ca:run: valueless --exam would silently fall back to the live set", ["--exam", "--mode", "sync"], CA_RUN, [
  "value",
]);
rejects("ca:run: collapsed --exam token", ["--exam upsc --wait 0"], CA_RUN, ["unrecognised", "whitespace"]);
rejects("ca:run: empty --exam= is not 'no exam'", ["--exam="], CA_RUN, ["empty"]);
accepts("ca:run: cron invocation (no --exam) is unchanged", ["--wait", "0"], CA_RUN, { wait: "0" });
accepts("ca:run: targeted pre-launch run parses", ["--exam", "upsc", "--days", "3"], CA_RUN, {
  exam: "upsc",
  days: "3",
});

rejects("ca:backfill: valueless --exam on a REWRITING tool", ["--exam", "--run"], CA_BACKFILL, ["value"]);
rejects("ca:backfill: collapsed token defeats --exam AND --max-usd", ["--exam upsc --run --max-usd 0.5"], CA_BACKFILL, [
  "unrecognised",
  "whitespace",
]);
accepts("ca:backfill: default plan-only invocation unchanged", [], CA_BACKFILL, {});
accepts("ca:backfill: targeted capped run parses", ["--exam", "upsc", "--run", "--max-usd", "0.5"], CA_BACKFILL, {
  exam: "upsc",
  run: true,
  "max-usd": "0.5",
});

// ---------------------------------------------------------------------------
// ca:widen-exam — the ADDITIVE corpus-widening tool (M48).
//
// Its argv failure modes are strictly WORSE than ca:backfill's, because it is
// the tool an operator reaches for AFTER being warned off the rewriting one: a
// lost `--exam` would widen the corpus by the exam that already owns it, and a
// lost `--apply` must fail CLOSED (to the dry run) rather than open.
// ---------------------------------------------------------------------------
const CA_WIDEN: FlagSpec = {
  boolean: ["apply", "dry-run"],
  value: ["exam"],
  positiveInt: ["limit"],
  positiveNumber: ["max-usd"],
};

accepts("ca:widen-exam: bare --exam is the DEFAULT dry run (no apply key ⇒ no write)", ["--exam", "upsc"], CA_WIDEN, {
  exam: "upsc",
});
accepts("ca:widen-exam: sampled dry run parses", ["--exam", "upsc", "--limit", "5"], CA_WIDEN, {
  exam: "upsc",
  limit: "5",
});
accepts("ca:widen-exam: capped write pass parses", ["--exam", "upsc", "--apply", "--max-usd", "8"], CA_WIDEN, {
  exam: "upsc",
  apply: true,
  "max-usd": "8",
});
rejects("ca:widen-exam: valueless --exam would widen by the wrong exam", ["--exam", "--apply"], CA_WIDEN, ["value"]);
rejects("ca:widen-exam: empty --exam= is not 'no exam'", ["--exam="], CA_WIDEN, ["empty"]);
rejects(
  "ca:widen-exam: collapsed token defeats --exam AND --limit AND --max-usd at once",
  ["--exam upsc --apply --max-usd 8"],
  CA_WIDEN,
  ["unrecognised", "whitespace"],
);
rejects("ca:widen-exam: --apply true is not a boolean spelling", ["--exam", "upsc", "--apply", "true"], CA_WIDEN, [
  "positional",
]);
rejects("ca:widen-exam: NaN --limit would widen the run to the whole corpus", ["--exam", "upsc", "--limit", "abc"], CA_WIDEN, [
  "limit",
]);
rejects("ca:widen-exam: --limit 0 is not a sample size", ["--exam", "upsc", "--limit", "0"], CA_WIDEN, ["limit"]);
rejects("ca:widen-exam: a negative budget cap is rejected", ["--exam", "upsc", "--apply", "--max-usd", "-1"], CA_WIDEN, [
  "max-usd",
]);

console.log(`✓ parseArgs guards: ${passed}/${passed} assertions passed`);
