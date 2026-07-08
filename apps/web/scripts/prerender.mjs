/**
 * Snapshots the public marketing routes to static HTML after `vite build`, so
 * crawlers (and the very first paint for real visitors) see real content
 * instead of an empty #root waiting on JS. This is a CSR snapshot, not true
 * SSR — main.tsx calls createRoot(...).render() (not hydrateRoot), so once
 * the JS bundle loads, React does a fresh client render and replaces this
 * markup wholesale. That's fine: crawlers that don't run JS get the
 * snapshot, everyone else gets the identical page moments later.
 *
 * Only /:locale (the landing page) is public today — /:locale/pricing lives
 * behind requireAuth (see router.tsx), so it isn't a real crawlable page and
 * is intentionally NOT snapshotted here. Making pricing public is a product
 * decision (routing + auth-gating change) outside this script's scope.
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
const ROUTES = ["/en", "/hi"];

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
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const server = await startStaticServer();
const browser = await chromium.launch();
const page = await browser.newPage();

for (const route of ROUTES) {
  await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle" });
  // The landing hero renders synchronously off i18n + auth-provider state
  // (no data fetching), so networkidle is already past first render — this
  // just guards against a slow CI runner's first paint.
  await page.waitForSelector("h1", { timeout: 10_000 });
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
}

await browser.close();
server.close();
