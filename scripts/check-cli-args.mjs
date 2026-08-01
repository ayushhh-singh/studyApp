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
 *   - `process.argv.slice(2)`  — the correct INPUT to the shared parser.
 *   - `process.argv[1]`        — the "was I invoked directly?" module guard.
 *                                A different concern entirely; not flag parsing.
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

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("cli-args-allow")) continue;
    // Skip comment lines — these files document the very patterns they forbid.
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;

    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        offenders.push({ file, line: i + 1, text: t.slice(0, 140), label });
        break;
      }
    }
  }
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

console.log(`✓ CLI-argument guard: all argv parsing goes through the shared parseArgs (${scanned} CLI files scanned).`);
