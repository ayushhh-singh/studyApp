/**
 * Snapshots the public marketing routes to static HTML after `vite build`, so
 * crawlers (and the very first paint for real visitors) see real content
 * instead of an empty #root waiting on JS. This is a CSR snapshot, not true
 * SSR — main.tsx calls createRoot(...).render() (not hydrateRoot), so once
 * the JS bundle loads, React does a fresh client render and replaces this
 * markup wholesale. That's fine: crawlers that don't run JS get the
 * snapshot, everyone else gets the identical page moments later.
 *
 * Public routes today: /:locale (the landing page), /:locale/pricing (moved
 * out of requireAuth so it's reachable signed-out — see router.tsx and
 * CLAUDE.md's TODO history), /:locale/about + /:locale/faq + /:locale/contact (the trust/
 * accuracy story and support surfaces), and the legal pages /:locale/terms,
 * /:locale/privacy, /:locale/refund. Every other route stays behind
 * requireAuth and has no reason to be indexed or snapshotted.
 *
 * Run via `pnpm --filter web prerender` AFTER `pnpm --filter web build` —
 * kept as a separate step (not chained into the default `build` script) so
 * a plain `pnpm build` never depends on Playwright/Chromium being installed.
 */
import { chromium } from "playwright";
import http from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "dist");
const PORT = 4321;
const ROUTES = [
  "/en",
  "/hi",
  "/en/pricing",
  "/hi/pricing",
  "/en/resources",
  "/hi/resources",
  "/en/about",
  "/hi/about",
  "/en/faq",
  "/hi/faq",
  "/en/contact",
  "/hi/contact",
  "/en/terms",
  "/hi/terms",
  "/en/privacy",
  "/hi/privacy",
  "/en/refund",
  "/hi/refund",
  "/en/uppsc",
  "/hi/uppsc",
  "/en/upsc",
  "/hi/upsc",
  "/en/uppsc/exam-updates/uppsc-pcs-exam-date-timeline-and-exam-pattern",
  "/hi/uppsc/exam-updates/uppsc-pcs-exam-date-timeline-and-exam-pattern",
  "/en/upsc/exam-updates/upsc-cse-exam-date-timeline-and-structure",
  "/hi/upsc/exam-updates/upsc-cse-exam-date-timeline-and-structure",
  "/en/features",
  "/hi/features",
  "/en/features/answer-evaluation",
  "/hi/features/answer-evaluation",
  "/en/features/test-series",
  "/hi/features/test-series",
  "/en/features/pyq-practice",
  "/hi/features/pyq-practice",
  "/en/features/current-affairs",
  "/hi/features/current-affairs",
  "/en/features/notes",
  "/hi/features/notes",
  "/en/features/revision",
  "/hi/features/revision",
  "/en/features/mentor",
  "/hi/features/mentor",
  "/en/features/gamified-practice",
  "/hi/features/gamified-practice",
  "/en/features/community",
  "/hi/features/community",
];

const MIME = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(DIST, urlPath);
    // path.join normalizes ".." segments, so a request like "/../../etc/passwd"
    // can resolve OUTSIDE dist/ — this server only ever talks to the Playwright
    // instance below on localhost, not untrusted input, but it costs nothing
    // to not model a path-traversal-shaped bug even in a throwaway build script.
    if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) filePath = path.join(DIST, "index.html");
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, () => resolve(server));
  });
}

const server = await startStaticServer();
let browser;
const failed = [];
try {
  browser = await chromium.launch();
  const page = await browser.newPage();

  for (const route of ROUTES) {
    // One route's failure must never lose the rest of the batch — confirmed
    // live on Cloudflare's actual build machine (2026-07-26): the un-isolated
    // version of this loop hit a single h1-timeout on the 5th route and threw,
    // silently discarding all 28 remaining routes (only 4/32 shipped that
    // build). A shared build container can genuinely be slower than a local
    // dev machine, so a real, non-flaky render taking longer than the local
    // timeout is a live risk here, not a hypothetical one — isolate per-route
    // and keep going.
    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle" });
      // The landing hero renders synchronously off i18n + auth-provider state
      // (no data fetching), so networkidle is already past first render — this
      // just guards against a slow CI runner's first paint. 20s (not the
      // original 10s) — a shared/CPU-constrained build container has real,
      // observed reason to need more headroom than a local dev machine.
      await page.waitForSelector("h1", { timeout: 20_000 });
      let html = await page.content();
      // React Router's lazy-loading injects modulepreload hints for the CURRENT
      // route's chunk with the page's full origin baked in (absolute, not
      // relative) — harmless on the temp prerender server but a dead cross-origin
      // preload once this file is deployed elsewhere, so rewrite back to root-relative.
      html = html.replaceAll(`http://localhost:${PORT}`, "");

      const outDir = path.join(DIST, route.slice(1));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "index.html"), html);
      console.log(`prerendered ${route} -> dist${route}/index.html`);
    } catch (err) {
      failed.push(route);
      console.warn(`FAILED to prerender ${route} — leaving no snapshot for it, continuing with the rest:`, err.message);
    }
  }

  if (failed.length > 0) {
    console.warn(`\n${failed.length}/${ROUTES.length} route(s) failed to prerender: ${failed.join(", ")}`);
    console.warn("Every other route above still got a real snapshot. A route with no snapshot here serves the");
    console.warn("generic app-shell instead of its own content/meta until the next successful prerender run.");
    process.exitCode = 1;
  }
} finally {
  // Always release the browser + port, even on failure — otherwise a failed
  // run leaves a zombie Chromium process and PORT bound, so the very next
  // retry hangs on server.listen() instead of failing with a clear error.
  await browser?.close();
  server.close();
}
