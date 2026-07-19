/**
 * Portability guard — fails if any tracked file contains a hardcoded,
 * machine-specific absolute filesystem path, OR a hardcoded, known-stale
 * production domain / Cloudflare Pages auto-domain.
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
 * DOMAIN CHECKS (added after the Domain-portability sweep session)
 * ------------------------------------------------------------------
 * A prior rename swept the repo for "prayasup" case-insensitive, which does
 * NOT match "prayas.pages.dev" as a substring (missing the "up") — a
 * hardcoded reference to a retired Cloudflare Pages preview domain survived
 * undetected. The domain has since moved again (`prayasup.app` → `neev.app`
 * → `neevstudy.com`, see CLAUDE.md's Branding note), so this guard checks
 * every KNOWN-stale domain by name, plus the whole `*.pages.dev` shape
 * generically — a bare Cloudflare Pages auto-domain should never be a
 * literal in source; it belongs in `ALLOWED_ORIGINS`/`VITE_SITE_URL` env
 * config instead. A genuinely explanatory doc example (e.g.
 * "<project-name>.pages.dev") gets the same `portable-paths-allow` escape
 * hatch as a path example — see below.
 *
 * USAGE
 *   node scripts/check-portable-paths.mjs      (also: pnpm check:paths)
 *   Exit 0 = clean, exit 1 = at least one offending path/domain found (prints them).
 *
 * This script is intentionally dependency-free (plain node, no build step) so
 * it runs identically in CI, a pre-push hook, and on any dev machine.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Offending path patterns. Each is anchored tightly enough to avoid false
// positives on ordinary code — e.g. a template literal like `Options:\n${x}`
// must NOT trip the Windows-drive rule, so that rule anchors on real
// top-level Windows folder names, never a bare `:\`. Scanned in every
// tracked file (no per-file exemptions beyond SKIP_FILES/SKIP_EXT below).
const PATH_PATTERNS = [
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

// Offending domain patterns — a hardcoded reference to a retired production
// domain or a Cloudflare Pages auto-domain. NOT scanned in HISTORICAL_DOCS
// (below): CLAUDE.md's session log and docs/OUTSTANDING.md are explicit,
// permanent changelogs that are supposed to keep old domain names as a
// factual record (see CLAUDE.md's own "Deliberately left as-is
// (historical/technical, not live branding)" note) — every other tracked
// file must be current.
const DOMAIN_PATTERNS = [
  {
    re: /\bprayasup\.app\b/i,
    label: "stale domain (prayasup.app — superseded, see CLAUDE.md Branding)",
  },
  {
    re: /\bneev\.app\b/i,
    label: "stale domain (neev.app — superseded by neevstudy.com)",
  },
  {
    re: /\bprayas\.pages\.dev\b/i,
    label: "stale domain (prayas.pages.dev — retired Cloudflare Pages preview domain)",
  },
  {
    re: /(?:[a-z0-9-]+\.)*pages\.dev\b/i,
    label:
      "Cloudflare Pages auto-domain (*.pages.dev) — read from ALLOWED_ORIGINS/ALLOWED_ORIGIN_SUFFIXES config, don't hardcode a project's preview domain",
  },
];

// Files that legitimately may not be scanned:
//  - this guard itself (its source contains the patterns, as regex literals)
//  - the lockfile (generated, huge, only ever registry URLs)
const SKIP_FILES = new Set([
  "scripts/check-portable-paths.mjs",
  "pnpm-lock.yaml",
]);

// Historical changelogs exempted from DOMAIN_PATTERNS only (still fully
// scanned against PATH_PATTERNS) — see the DOMAIN_PATTERNS comment above.
const HISTORICAL_DOCS = new Set(["CLAUDE.md", "docs/OUTSTANDING.md"]);

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

  const patterns = HISTORICAL_DOCS.has(file)
    ? PATH_PATTERNS
    : [...PATH_PATTERNS, ...DOMAIN_PATTERNS];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // Escape hatch for docs/comments that legitimately SHOW an example
    // pattern while explaining the rule (a linter can't reference its own
    // forbidden tokens). Add `portable-paths-allow` on the line to suppress.
    if (lines[i].includes("portable-paths-allow")) continue;
    for (const { re, label } of patterns) {
      const m = re.exec(lines[i]);
      if (m) {
        offenders.push({ file, line: i + 1, label, match: m[0], text: lines[i].trim() });
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `\n✖ Portability guard: found ${offenders.length} hardcoded machine-specific path(s)/stale domain(s).\n` +
      `  Paths only work on one machine and break in CI / Docker / a fresh clone —\n` +
      `  resolve them from import.meta.url (or reuse ROOT in ingest/_shared.ts /\n` +
      `  scripts/fetch-content.ts) instead. Domains must come from config\n` +
      `  (ALLOWED_ORIGINS / VITE_SITE_URL), never a literal, so the next domain\n` +
      `  change doesn't repeat this. See docs/operations.md → "Portability guard".\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  [${o.label}]`);
    console.error(`      ${o.text}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `✓ Portability guard: no hardcoded machine-specific paths or stale domains in ${
    trackedFiles().length
  } tracked files.`,
);
