/**
 * CLI-argument guard — fails if any CLI parses `process.argv` itself instead of
 * going through the ONE shared, schema-validated parser.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-31 a mis-shaped argv ran `ingest:syllabus` for real against the
 * production DB, twice (docs/OUTSTANDING.md §0d). The root cause was a permissive
 * parser: a bare positional produced NO key, a collapsed multi-word token became
 * a NONSENSE key, and a valueless value-flag became boolean `true` — so a scoped,
 * dry-run invocation silently WIDENED into a billed, DB-writing one.
 *
 * The fix (D12) made `parseArgs` in `apps/api/src/ingest/_shared.ts` take a
 * REQUIRED per-script `FlagSpec` and refuse anything it does not fully
 * understand. But that only protects callers who actually use it — and when the
 * fix was written the repo had **six** different hand-rolled arg-parsing
 * dialects, several of which never appeared in a `parseArgs` search at all:
 *
 *   1. the shared `parseArgs`                      (now the only allowed one)
 *   2. private verbatim clones of the old parser
 *   3. `out[key] = argv[i + 1] ?? ""` with no `i++`
 *   4. switch-style `if (argv[i] === "--x") v = argv[++i]`
 *   5. `argVal()`: `const i = argv.indexOf(flag); return argv[i + 1]`
 *   6. `process.argv.find(a => a.startsWith("--kinds="))`
 *
 * Every one of them loses a `--dry-run`/`--apply` in some argv shape. This guard
 * exists so a SEVENTH cannot appear: consolidating was the expensive part, and
 * without a standing check it would silently erode again. It is the same
 * reasoning as scripts/check-portable-paths.mjs — a *class* of bug, not a typo.
 *
 * THE CORRECT PATTERN
 * -------------------
 *   import { parseArgs } from "<rel>/ingest/_shared.js";
 *   const args = parseArgs(
 *     process.argv.slice(2),
 *     { value: ["paper"], boolean: ["dry-run"], positiveInt: ["limit"] },
 *     "my:script",
 *   );
 *
 * DELIBERATELY STILL ALLOWED
 * --------------------------
 *   - `process.argv.slice(2)`  — the correct INPUT to the shared parser, but ONLY
 *                                when it is handed straight to `parseArgs`. See
 *                                "THE ALIAS HOLE" below: binding it to a local
 *                                first is NOT allowed.
 *   - `process.argv[1]`        — the "was I invoked directly?" module guard.
 *                                A different concern entirely; not flag parsing.
 *
 * THE ALIAS HOLE (closed 2026-08-01)
 * ----------------------------------
 * The first version of this guard anchored every pattern on the literal string
 * `process.argv`, and allow-listed `process.argv.slice(2)` as "the correct input
 * to the shared parser" — without ever checking that the slice reached the
 * parser. Binding it to a local made every check go blind:
 *
 *     const argv = process.argv.slice(2);          // allow-listed
 *     if (argv[i] === "--user") userArg = argv[++i];   // matched NOTHING
 *
 * Four CLIs did exactly that and were reported as protected, including
 * `mastery:build`, whose no-`--user` branch writes `node_mastery` for EVERY user
 * — so a collapsed `"--user <uuid>"` token fanned a single-user backfill out to
 * an all-users write, the incident's shape verbatim. The guard printed
 * "✓ all argv parsing goes through the shared parseArgs" the whole time.
 *
 * So the scanner now resolves ALIASES: any local bound directly to a
 * `process.argv` expression is tracked, and flag-reading through that local is
 * an offence exactly as if `process.argv` had been written inline. A binding
 * whose initialiser is a CALL (`const args = parseArgs(process.argv.slice(2), …)`)
 * is not an alias — that is the correct pattern, and its result is a parsed
 * record that call sites legitimately index (`args["dry-run"]`).
 *
 * NEGATIVE CONTROL
 * ----------------
 * A guard that only ever passes proves nothing — this repo has now been burned by
 * exactly that twice. `SELF_TEST` below runs on EVERY invocation (in memory, no
 * I/O) and asserts the scanner both FIRES on each known-bad shape and STAYS
 * SILENT on each known-good one. If the self-test fails the guard exits non-zero
 * without even scanning the repo, because at that point its verdict is worthless.
 *
 * ESCAPE HATCH
 * ------------
 * Put `cli-args-allow:` on the line with a reason. Use it for documentation and
 * examples, not to opt a real CLI out of validation.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The one file allowed to implement argv parsing. */
const PARSER_HOME = "apps/api/src/ingest/_shared.ts";

/**
 * Only CLIs are in scope. The web app never parses argv, and node_modules/dist
 * are not ours.
 */
const IN_SCOPE = /^apps\/api\/(src|scripts)\/.*\.ts$/;

const PATTERNS = [
  {
    // A locally-defined arg parser — dialects 2-5. This is the precise signal
    // that a new dialect is being introduced.
    re: /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(parseArgs|parseFlags|argVal|argValue|getArg|getFlag|readArg)\b/,
    label:
      "defines a local argument parser — import { parseArgs } from the shared _shared.js instead (see docs/OUTSTANDING.md D12)",
  },
  {
    // Dialect 5/6 and the `--apply` sniff: reading flags straight off process.argv.
    re: /process\.argv\s*\.\s*(includes|indexOf|find|filter|some)\s*\(/,
    label:
      "reads flags directly off process.argv — pass process.argv.slice(2) to the shared parseArgs with a FlagSpec instead",
  },
  {
    // Indexing argv for a value, e.g. `process.argv[i + 1]`. `process.argv[1]`
    // (the invoked-directly guard) is deliberately NOT matched.
    re: /process\.argv\s*\[\s*(?!1\s*\])[^\]]*\]/,
    label:
      "indexes process.argv to read a flag value — use the shared parseArgs (process.argv[1] for an invoked-directly guard is fine)",
  },
];

/**
 * Locals bound DIRECTLY to a `process.argv` expression — `const argv =
 * process.argv.slice(2)`, `let a = process.argv`, or a later bare `argv =
 * process.argv…` assignment.
 *
 * The `=\s*process\.argv` anchor is what keeps this precise: it requires
 * `process.argv` to be the very next thing after the `=`, so a binding whose
 * initialiser is a CALL — `const args = parseArgs(process.argv.slice(2), spec,
 * name)`, including the multi-line form — is deliberately NOT an alias. That
 * distinction matters: a parsed record is legitimately indexed with a bracket
 * (`args["dry-run"]` for a dashed flag name), which would otherwise be a flood of
 * false positives on correctly-migrated CLIs.
 */
function argvAliases(text) {
  const aliases = new Set();
  const re = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*process\s*\.\s*argv\b/g;
  let m;
  while ((m = re.exec(text)) !== null) aliases.add(m[1]);
  return aliases;
}

/** Flag-reading through an alias: `argv.includes("--x")`, `argv[i + 1]`. */
function aliasPatterns(aliases) {
  return [...aliases].flatMap((name) => {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [
      {
        re: new RegExp(`\\b${n}\\s*\\.\\s*(?:includes|indexOf|find|filter|some)\\s*\\(`),
        label:
          `reads flags off \`${name}\`, a local bound to process.argv — an alias is not an escape from the ` +
          `guard; pass process.argv.slice(2) straight to the shared parseArgs with a FlagSpec`,
      },
      {
        re: new RegExp(`\\b${n}\\s*\\[`),
        label:
          `indexes \`${name}\`, a local bound to process.argv, to read a flag value — use the shared parseArgs`,
      },
    ];
  });
}

/**
 * The whole scanner, as a PURE function of (path, source) so the negative
 * control below can exercise it without touching the filesystem.
 */
function scanText(file, text) {
  const found = [];
  const patterns = [...PATTERNS, ...aliasPatterns(argvAliases(text))];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("cli-args-allow")) continue;
    // Skip comment lines — these files document the very patterns they forbid.
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;

    for (const { re, label } of patterns) {
      if (re.test(line)) {
        found.push({ file, line: i + 1, text: t.slice(0, 140), label });
        break;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL — runs on every invocation, in memory, before the real scan.
// Each BAD fixture is a shape that actually shipped; each GOOD fixture is a
// shape that must never be flagged. See "NEGATIVE CONTROL" in the header.
// ---------------------------------------------------------------------------
const SELF_TEST = {
  bad: [
    // The four CLIs the alias hole hid, in their pre-2026-08-01 form.
    ["mastery/cli", 'const argv = process.argv.slice(2);\nif (argv[i] === "--user") userArg = argv[++i];'],
    ["ca/embed-backfill", 'const argv = process.argv.slice(2);\nconst all = argv.includes("--all");'],
    ["ingest/embed-verify", 'const argv = process.argv.slice(2);\nconst purge = argv.includes("--purge-orphans");'],
    ["notes/embed", 'const args = process.argv.slice(2);\nconst i = args.indexOf("--limit");'],
    // Aliasing under other binding forms must not sneak past either.
    ["alias/let", 'let a = process.argv.slice(2);\nconst n = a.indexOf("--limit");'],
    ["alias/reassign", 'let a;\na = process.argv.slice(2);\nif (a.includes("--apply")) run();'],
    ["alias/whole-argv", "const raw = process.argv;\nconst v = raw[3];"],
    // The original dialects, still caught.
    ["inline/includes", 'if (process.argv.includes("--apply")) run();'],
    ["inline/index", "const v = process.argv[i + 1];"],
    ["local/parser", "function parseArgs(argv) { return {}; }"],
  ],
  good: [
    // The one correct pattern, single-line and multi-line, including a dashed
    // flag read back with a bracket — the exact shape a naive alias rule breaks.
    [
      "correct/inline",
      'const args = parseArgs(process.argv.slice(2), { boolean: ["dry-run"] }, "x");\nconst d = args["dry-run"] === true;',
    ],
    [
      "correct/multiline",
      'const args = parseArgs(\n  process.argv.slice(2),\n  { value: ["node"] },\n  "notes:embed",\n);\nconst n = args["node"];',
    ],
    // The invoked-directly module guard, and an unrelated local also called argv.
    ["allowed/argv1", 'if (process.argv[1].endsWith("embed.ts")) main();'],
    ["allowed/unrelated", 'const argv = buildArgs();\nconst x = argv[0];'],
    // The documented escape hatch.
    ["allowed/escape", 'const v = process.argv[2]; // cli-args-allow: doc example'],
  ],
};

const selfTestFailures = [];
for (const [name, src] of SELF_TEST.bad) {
  if (scanText(`self-test:${name}`, src).length === 0) {
    selfTestFailures.push(`BAD fixture "${name}" was NOT flagged — the guard is blind to a shape that shipped.`);
  }
}
for (const [name, src] of SELF_TEST.good) {
  const hits = scanText(`self-test:${name}`, src);
  if (hits.length > 0) {
    selfTestFailures.push(`GOOD fixture "${name}" was flagged (${hits[0].label}) — the guard has a false positive.`);
  }
}
if (selfTestFailures.length > 0) {
  console.error("");
  console.error("✗ CLI-argument guard: its own negative control FAILED — refusing to report a verdict.");
  console.error("  A guard that cannot demonstrate it fires is worthless (docs/OUTSTANDING.md §0d).");
  console.error("");
  for (const f of selfTestFailures) console.error(`  ${f}`);
  console.error("");
  process.exit(1);
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

const offenders = [];
let scanned = 0;

for (const file of trackedFiles()) {
  if (!IN_SCOPE.test(file)) continue;
  if (file === PARSER_HOME) continue;

  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  scanned++;
  offenders.push(...scanText(file, text));
}

if (offenders.length > 0) {
  console.error("");
  console.error("✗ CLI-argument guard: found hand-rolled argv parsing outside the shared parser.");
  console.error("");
  console.error("  A permissive parser caused a real production incident (docs/OUTSTANDING.md §0d):");
  console.error("  a mis-shaped argv silently DROPPED --dry-run and ran a billed, DB-writing pass.");
  console.error("  Use the shared parseArgs + a FlagSpec so a misparse is loud, not silent.");
  console.error("");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  [${o.label}]`);
    console.error(`      ${o.text}`);
  }
  console.error("");
  console.error("  If a match is genuinely documentation or an example, add `cli-args-allow:` on the line with a reason.");
  console.error("");
  process.exit(1);
}

console.log(
  `✓ CLI-argument guard: all argv parsing goes through the shared parseArgs ` +
    `(${scanned} CLI files scanned; ${SELF_TEST.bad.length} bad + ${SELF_TEST.good.length} good fixtures negative-controlled).`,
);
