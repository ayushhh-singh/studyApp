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
 * any reason (this repo has an explicit, disclosed, NEVER actually verified
 * risk here: `--with-deps` needs root/apt access that a managed CI image may
 * not grant — see docs/operations.md), the correct behavior is to log it
 * loudly and let the already-good plain build ship anyway. The first version
 * of this script used `execSync`, which throws on a non-zero child exit —
 * that would have propagated up through `build` and failed the ENTIRE
 * Cloudflare deploy over a missing enhancement, blocking every future deploy
 * too until fixed. Never repeat that mistake here.
 */
import { execSync } from "node:child_process";

if (!process.env.CF_PAGES) {
  process.exit(0);
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

console.log("[postbuild] CF_PAGES detected — attempting to install Chromium and prerender public routes...");

let chromiumReady = false;
try {
  run("npx playwright install --with-deps chromium");
  chromiumReady = true;
} catch (err) {
  console.warn("[postbuild] `playwright install --with-deps chromium` failed:", err.message);
  console.warn("[postbuild] Falling back to a plain browser download (no system package install, works without root) —");
  console.warn("[postbuild] this can still fail at launch time later if the image is missing a shared library Chromium needs.");
  try {
    run("npx playwright install chromium");
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
