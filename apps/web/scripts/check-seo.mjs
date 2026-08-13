/**
 * `pnpm --filter web check:seo` — a standing guard over the crawlable surface.
 *
 * WHY THIS EXISTS. `public/robots.txt` is a blanket `Disallow: /` plus an
 * exact-match allow-list, and `public/sitemap.xml` + `scripts/prerender.mjs` are
 * two more hand-maintained lists of the same pages. Nothing kept the three in
 * agreement, and both failure modes are silent — the site keeps building, the
 * pages keep rendering, and the damage only shows up in Search Console weeks
 * later. Both had already happened by 2026-08-13:
 *
 *   - /resources and /contact were added to the sitemap AND prerendered, and
 *     never added to robots. So four URLs were simultaneously advertised to
 *     Google and forbidden to it ("Submitted URL blocked by robots.txt").
 *   - The SITE ROOT "/" matched only the blanket disallow. Google discovers a
 *     favicon at /favicon.ico or from the HOME PAGE's <link rel="icon">, so with
 *     the root uncrawlable it could never learn the icon existed — which is why
 *     the app's logo was missing beside the site in search results. Allowing the
 *     asset is not enough; the page that DECLARES it has to be fetchable.
 *
 * It also guards the direction nobody thinks about: that a fix does not
 * accidentally open the authenticated app to crawlers.
 *
 * Pure — reads four files, no network, no build. Safe in CI before `pnpm install`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolved from import.meta.url, never process.cwd() — this repo's portability
// rule, so the guard behaves identically from the repo root, from apps/web, and
// in CI (see docs/operations.md "Portability guard").
const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(WEB, p), "utf8");

const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const prerender = read("scripts/prerender.mjs");
const router = read("src/router.tsx");
const indexHtml = read("index.html");

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.error(`  ✗ ${msg}`);
};

/**
 * Google's robots.txt matching, implemented rather than eyeballed: the LONGEST
 * matching path wins, an equal-length tie goes to the least restrictive rule
 * (Allow), `$` anchors the end of the path and `*` is a wildcard.
 * https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
 */
function ruleToRegex(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.endsWith("$")) {
    p = p.slice(0, -1);
    anchored = true;
  }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

const rules = [];
for (const line of robots.split("\n")) {
  const m = line.match(/^\s*(Allow|Disallow):\s*(\S+)\s*$/i);
  if (m) {
    rules.push({
      type: m[1].toLowerCase(),
      pattern: m[2],
      re: ruleToRegex(m[2]),
      length: m[2].replace(/\$$/, "").length,
    });
  }
}

function crawlable(path) {
  let best = null;
  for (const rule of rules) {
    if (!rule.re.test(path)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.type === "allow")) best = rule;
  }
  // No rule at all means allowed, which is robots.txt's own default.
  return best ? best.type === "allow" : true;
}

// --------------------------------------------------------------- the lists
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const prerenderRoutes = [...prerender.slice(prerender.indexOf("const ROUTES = [")).split("];")[0].matchAll(/"([^"]+)"/g)].map(
  (m) => m[1],
);
// A public route is a child of /:locale declared BEFORE the require-auth subtree.
const beforeAuth = router.slice(0, router.indexOf('lazy: () => import("@/routes/require-auth")'));
const publicPaths = [...beforeAuth.matchAll(/\{ path: "([^"]+)", lazy/g)].map((m) => m[1]);
// `auth*` is deliberately not indexable (app entry, not content) and a `:param`
// route has no single URL to list.
const indexable = publicPaths.filter((p) => !p.startsWith("auth") && !p.includes(":"));

// 1. Nothing may be advertised and blocked at the same time.
for (const url of sitemapUrls) {
  if (!crawlable(url)) fail(`sitemap advertises ${url} but robots.txt BLOCKS it`);
}

// 2. A sitemap URL that is not prerendered serves a crawler an empty SPA shell.
const inSitemap = new Set(sitemapUrls);
const inPrerender = new Set(prerenderRoutes);
for (const url of sitemapUrls) {
  if (!inPrerender.has(url)) fail(`${url} is in the sitemap but NOT in scripts/prerender.mjs — crawlers get an empty shell`);
}
for (const url of prerenderRoutes) {
  if (!inSitemap.has(url)) fail(`${url} is prerendered but missing from the sitemap`);
}

// 3. A new public page must reach the sitemap, in both locales.
for (const path of indexable) {
  for (const locale of ["en", "hi"]) {
    if (!inSitemap.has(`/${locale}/${path}`)) fail(`public route /${locale}/${path} is missing from the sitemap`);
  }
}

// 4. The favicon-discovery chain, and the assets a crawler needs to render.
//    "/" is here because a blocked home page is why the site had no favicon in
//    search results — see this file's header.
for (const asset of ["/", "/favicon.png", "/og-default-en.png", "/og-default-hi.png", "/sitemap.xml"]) {
  if (!crawlable(asset)) fail(`${asset} is blocked by robots.txt, but a crawler needs it`);
}

// 5. The other direction: opening the root must not open the app.
for (const appRoute of [
  "/en/dashboard",
  "/en/profile",
  "/en/practice",
  "/en/auth",
  "/hi/review",
  "/en/pyq-archive",
  "/en/admin-users",
  "/en/community",
]) {
  if (crawlable(appRoute)) fail(`${appRoute} is CRAWLABLE — an allow rule is too broad`);
}

// 6. hreflang must pair a page with ITS OWN translation, not another page's —
//    the failure mode when a <url> block is copy-pasted and half-edited.
for (const block of [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1])) {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
  if (!loc) continue;
  const path = new URL(loc).pathname.replace(/^\/(en|hi)/, "");
  for (const [, lang, href] of block.matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g)) {
    const altPath = new URL(href).pathname.replace(/^\/(en|hi)/, "");
    if (altPath !== path) fail(`${loc}: hreflang="${lang}" points at ${href}, a different page`);
  }
  const langs = [...block.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]).sort().join(",");
  if (langs !== "en,hi,x-default") fail(`${loc}: hreflang set is "${langs}", expected en,hi,x-default`);
}

// 7. index.html's title/description are the fallback a crawler shows for any page
//    it has not re-crawled since prerendering. They must not name a commission:
//    which exams are live is a registry fact (`exams.is_live`) that a static file
//    cannot track, and naming one is exactly how this went stale — it still read
//    "Neev — UPPSC Exam Prep" months after a second exam went live.
const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
// Scoped to the two tags a crawler actually SHOWS, not the whole head — the head
// also carries the comment explaining this rule, which necessarily names the
// exams it is telling you not to name. Checking the raw head made this guard
// fail on its own documentation.
const staticTitle = head.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
const staticDescription = head.match(/<meta\s+name="description"\s+content="([\s\S]*?)"/)?.[1] ?? "";
const shown = `${staticTitle} ${staticDescription}`;
for (const token of ["UPPSC", "MPPSC", "UP PCS"]) {
  if (shown.includes(token)) fail(`index.html's static ${staticTitle.includes(token) ? "<title>" : "description"} names "${token}" — keep the fallback exam-neutral`);
}
// Checked after stripping UPPSC, since "UPSC" is a substring of it.
if (/\bUPSC\b/.test(shown.replace(/UPPSC/g, ""))) {
  fail(`index.html's static title/description names "UPSC" — keep the fallback exam-neutral`);
}
if (!staticTitle.trim()) fail("index.html has no static <title> — it is the fallback for an un-recrawled page");
if (!staticDescription.trim()) fail("index.html has no static meta description");
if (!/<link[^>]+rel="icon"/.test(head)) fail('index.html declares no <link rel="icon"> — Google reads the favicon from here');

if (problems === 0) {
  console.log(
    `✓ SEO guard: ${sitemapUrls.length} sitemap URLs all crawlable and prerendered, ` +
      `${indexable.length} public routes x 2 locales listed, hreflang consistent, app routes still blocked.`,
  );
  process.exit(0);
}
console.error(`\n${problems} SEO problem(s). robots.txt / sitemap.xml / scripts/prerender.mjs must agree.`);
process.exit(1);
