/**
 * Runs after every `vite build` as part of the plain `build` script. A no-op
 * everywhere EXCEPT an actual Cloudflare Pages build (detected via the
 * `CF_PAGES` system env var Cloudflare documents as the reliable "this is a
 * Pages build" flag: https://developers.cloudflare.com/pages/configuration/build-configuration/).
 *
 * WHY THIS EXISTS: Cloudflare Pages' git-integrated builds only support
 * setting the "Build command" via the dashboard UI — there is no
 * repo-committed config file Cloudflare reads for it (confirmed against
 * their current docs). Gating on CF_PAGES here makes the plain `build`
 * command self-sufficient on Cloudflare with no dashboard access needed, and
 * leaves GitHub Actions CI and the dormant `vercel.json` config (neither sets
 * CF_PAGES) completely unaffected — see docs/operations.md's "Free-tier (₹0)
 * deploy" section for the full history.
 *
 * CRITICAL, NON-NEGOTIABLE CONTRACT: this script must NEVER exit non-zero.
 * It is chained with `&&` onto the end of `build` (`tsc -b && vite build &&
 * node scripts/postbuild.mjs`), which already succeeded by the time this
 * runs — a real, working `dist/` exists. Prerendering is a pure enhancement
 * on top of that; if the chromium install or the prerender pass fails for
 * any reason, the correct behavior is to log it loudly and let the
 * already-good plain build ship anyway. An earlier version of this script
 * used `execSync` with no try/catch, which threw and failed the ENTIRE
 * Cloudflare deploy over prerendering alone failing — never repeat that.
 *
 * SECOND REAL BUG this version fixes: `npx playwright install ...` (and even
 * `pnpm exec playwright`) is NOT guaranteed to resolve the same `playwright`
 * package version this workspace has pinned (`apps/web/package.json`) —
 * confirmed live in this repo: both resolved a stale 1.61.1 CLI (apparently
 * hoisted to the monorepo root from some earlier install) while the actual
 * `apps/web/node_modules/playwright` `prerender.mjs` imports is 1.62.0. That
 * mismatch downloads a Chromium build tied to the WRONG playwright version,
 * so `chromium.launch()` in prerender.mjs fails with "Looks like Playwright
 * was just installed or updated" — silently (thanks to the try/catch below),
 * degrading every build back to zero prerendering with no visible error
 * anywhere but a Cloudflare build log nobody may ever check. Fixed by
 * resolving the CLI script directly off the exact `playwright` package this
 * workspace's `node_modules` gives `prerender.mjs`, via Node's own module
 * resolution — never a PATH-dependent `playwright`/`npx playwright`/`pnpm
 * exec playwright` lookup, all three of which this repo has now shown can
 * resolve inconsistently in a pnpm workspace.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

if (!process.env.CF_PAGES) {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const playwrightCli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

console.log(`[postbuild] CF_PAGES detected — attempting to install Chromium (via ${playwrightCli}) and prerender public routes...`);

let chromiumReady = false;
try {
  run(`node "${playwrightCli}" install --with-deps chromium`);
  chromiumReady = true;
} catch (err) {
  console.warn("[postbuild] `playwright install --with-deps chromium` failed:", err.message);
  console.warn("[postbuild] Falling back to a plain browser download (no system package install, works without root) —");
  console.warn("[postbuild] this can still fail at launch time later if the image is missing a shared library Chromium needs.");
  try {
    run(`node "${playwrightCli}" install chromium`);
    chromiumReady = true;
  } catch (err2) {
    console.warn("[postbuild] Fallback browser install also failed:", err2.message);
  }
}

if (chromiumReady) {
  try {
    run("node scripts/prerender.mjs");
    console.log("[postbuild] Prerender complete.");
  } catch (err) {
    console.warn("[postbuild] Prerendering failed after a successful browser install:", err.message);
  }
}

if (!chromiumReady) {
  console.warn(
    "[postbuild] Skipping prerendering for this build — shipping the plain (un-prerendered) Vite output instead. " +
      "The site is still fully functional; only crawlers that don't execute JS see the generic app-shell " +
      "<title>/meta instead of each page's real content until this is resolved. " +
      "See docs/operations.md's Prerendering section for how to investigate.",
  );
}

// Always exit 0 — see the file-level comment. A missing enhancement is never
// worth failing (and thus blocking) the whole deploy.
process.exit(0);
