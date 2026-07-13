/**
 * Portability guard — fails if any tracked file contains a hardcoded,
 * machine-specific absolute filesystem path.
 *
 * WHY THIS EXISTS
 * ---------------
 * A hardcoded path like `/Users/<name>/Desktop/Code/studyApp/...` only ever
 * resolves on the one machine it was typed on. It breaks the moment the repo
 * is cloned elsewhere, run in CI (ubuntu, working dir differs from a laptop),
 * or built into the API Docker image (linux). It is a *class* of bug, not a
 * typo, so it gets a standing check rather than a one-off fix. See
 * docs/operations.md → "Portability guard" for the full rationale.
 *
 * The correct pattern in this repo is ALWAYS to resolve from the module's own
 * location, never a hardcoded prefix or an assumed process.cwd():
 *
 *   import { fileURLToPath } from "node:url";
 *   import { dirname, join } from "node:path";
 *   const __dirname = dirname(fileURLToPath(import.meta.url));   // or import.meta.dirname
 *   const ROOT = join(__dirname, "..", ...);                     // repo-relative
 *
 * Reuse the existing helpers instead of re-deriving:
 *   - apps/api/src/ingest/_shared.ts  → ROOT / CONTENT_RAW / PARSED_DIR
 *   - scripts/fetch-content.ts        → ROOT
 *
 * USAGE
 *   node scripts/check-portable-paths.mjs      (also: pnpm check:paths)
 *   Exit 0 = clean, exit 1 = at least one offending path found (prints them).
 *
 * This script is intentionally dependency-free (plain node, no build step) so
 * it runs identically in CI, a pre-push hook, and on any dev machine.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Offending patterns. Each is anchored tightly enough to avoid false positives
// on ordinary code — e.g. a template literal like `Options:\n${x}` must NOT
// trip the Windows-drive rule, so that rule anchors on real top-level Windows
// folder names, never a bare `:\`.
const PATTERNS = [
  {
    re: /\/Users\/[A-Za-z0-9._-]+/,
    label: "macOS home path (/Users/<name>/…)",
  },
  {
    re: /\/home\/[A-Za-z0-9._-]+\//,
    label: "Linux home path (/home/<name>/…)",
  },
  {
    re: /\b[A-Za-z]:\\{1,2}(?:Users|Documents|Desktop|Downloads|Windows|Program Files)/i,
    label: "Windows drive path (C:\\Users\\… etc.)",
  },
  {
    re: /\bDesktop\/Code\//,
    label: "developer scratch path (…/Desktop/Code/…)",
  },
];

// Files that legitimately may not be scanned:
//  - this guard itself (its source contains the patterns, as regex literals)
//  - the lockfile (generated, huge, only ever registry URLs)
const SKIP_FILES = new Set([
  "scripts/check-portable-paths.mjs",
  "pnpm-lock.yaml",
]);

// Binary / non-source extensions we never scan.
const SKIP_EXT =
  /\.(png|jpe?g|webp|gif|ico|svg|pdf|woff2?|ttf|otf|eot|mp[34]|zip|gz|wasm)$/i;

/** Tracked files only → automatically respects .gitignore, node_modules, .git. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

const offenders = [];

for (const file of trackedFiles()) {
  if (SKIP_FILES.has(file) || SKIP_EXT.test(file)) continue;

  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue; // unreadable / removed mid-run — nothing to scan
  }
  // Skip anything that looks binary (has a NUL byte).
  if (text.includes("\0")) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // Escape hatch for docs/comments that legitimately SHOW an example
    // pattern while explaining the rule (a linter can't reference its own
    // forbidden tokens). Add `portable-paths-allow` on the line to suppress.
    if (lines[i].includes("portable-paths-allow")) continue;
    for (const { re, label } of PATTERNS) {
      const m = re.exec(lines[i]);
      if (m) {
        offenders.push({ file, line: i + 1, label, match: m[0], text: lines[i].trim() });
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `\n✖ Portability guard: found ${offenders.length} hardcoded machine-specific path(s).\n` +
      `  These only work on one machine and break in CI / Docker / a fresh clone.\n` +
      `  Resolve paths from import.meta.url (or reuse ROOT in ingest/_shared.ts /\n` +
      `  scripts/fetch-content.ts) instead. See docs/operations.md → "Portability guard".\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  [${o.label}]`);
    console.error(`      ${o.text}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `✓ Portability guard: no hardcoded machine-specific paths in ${
    trackedFiles().length
  } tracked files.`,
);
