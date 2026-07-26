/**
 * Copies dist/index.html to dist/__spa-fallback.html, every build, on every
 * host (not gated behind CF_PAGES — this is a fast, always-needed step, and
 * `wrangler pages dev`/local testing needs it too).
 *
 * WHY: Cloudflare Pages' own build-time redirect linter flags
 * `/*    /index.html    200` in `_redirects` as an "infinite loop" and
 * SILENTLY DROPS the rule entirely (confirmed live, 2026-07-26 — see the
 * build log referenced in git history for this commit). Cloudflare's own
 * team has acknowledged this is a false positive for a plain SPA fallback
 * (https://github.com/cloudflare/workers-sdk/issues/11824), but nothing
 * repo-side can fix Cloudflare's linter — the community-verified workaround
 * is to point the fallback at a filename that ISN'T literally `index.html`,
 * which the linter doesn't special-case. The live site was NOT actually
 * broken by the dropped rule (Cloudflare Pages has its own undocumented
 * built-in "serve index.html for an unmatched SPA path" default that was
 * silently covering for it), but relying on unwritten platform-default
 * behavior instead of an explicit, correctly-applied rule is exactly the
 * kind of thing that breaks without warning on some future Cloudflare
 * change — hence this fix, not a shrug.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const src = path.join(DIST, "index.html");
const dest = path.join(DIST, "__spa-fallback.html");

if (!existsSync(src)) {
  console.error(`[copy-spa-fallback] ${src} does not exist — did vite build run first?`);
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`[copy-spa-fallback] dist/index.html -> dist/__spa-fallback.html`);
