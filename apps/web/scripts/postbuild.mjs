/**
 * Runs after every `vite build` as part of the plain `build` script. A no-op
 * everywhere EXCEPT an actual Cloudflare Pages build (detected via the
 * `CF_PAGES` system env var Cloudflare documents as the reliable "this is a
 * Pages build" flag: https://developers.cloudflare.com/pages/configuration/build-configuration/).
 *
 * WHY THIS EXISTS: Cloudflare Pages' git-integrated builds only support
 * setting the "Build command" via the dashboard UI — there is no
 * repo-committed config file Cloudflare reads for it (confirmed against
 * their current docs). The dashboard is still configured to run the plain
 * `pnpm --filter web build` (confirmed live: every public page serves the
 * generic app-shell <title>/meta instead of its prerendered per-page
 * values), and nobody with account access has changed it to `build:ci`. This
 * script closes that gap without needing dashboard access at all: since
 * `CF_PAGES=1` is present on every real Cloudflare Pages build regardless of
 * which script name is configured, gating on it here makes the ALREADY
 * -configured plain `build` command self-sufficient.
 *
 * Deliberately scoped to CF_PAGES only, not merged unconditionally into
 * `build` — that would also slow down `.github/workflows/ci.yml`'s "Typecheck
 * + build web" step (which calls this exact script and has no need for a
 * browser download) and would reintroduce, for the dormant `vercel.json`
 * fallback config, the exact "no guaranteed root/apt access for a managed
 * build image" fragility risk that was deliberately kept opt-in there (see
 * docs/operations.md's Free-tier deploy section). Neither GitHub Actions nor
 * Vercel set CF_PAGES, so both are completely unaffected by this script.
 */
import { execSync } from "node:child_process";

if (!process.env.CF_PAGES) {
  process.exit(0);
}

console.log("[postbuild] CF_PAGES detected — installing Chromium and prerendering public routes...");
execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
execSync("node scripts/prerender.mjs", { stdio: "inherit" });
console.log("[postbuild] Prerender complete.");
