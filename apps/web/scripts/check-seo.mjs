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
const articlesSrc = read("src/lib/articles.ts");

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
// ⚑ Assert the marker exists. `indexOf` returns -1 when it moves, and
// `slice(0, -1)` would then treat the ENTIRE router as public — the guard still
// fails, but with a flood of "route missing from sitemap" noise instead of the
// real cause. Fail on the cause.
const AUTH_MARKER = 'lazy: () => import("@/routes/require-auth")';
const authAt = router.indexOf(AUTH_MARKER);
if (authAt === -1) {
  console.error(`  ✗ src/router.tsx no longer contains ${AUTH_MARKER} — this guard cannot tell public routes from app routes. Update the marker.`);
  process.exit(1);
}
const beforeAuth = router.slice(0, authAt);
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

// ---------------------------------------------------------- the content hub
/**
 * ⚑ THE CONTENT HUB NEEDS ITS OWN COVERAGE, AND ASSUMING OTHERWISE WOULD HAVE
 * LEFT EVERY ARTICLE UNGUARDED. Rule 3 above derives public routes from
 * router.tsx and then drops any path containing `:` — correct, because a param
 * route has no single URL to list. But an article route IS
 * `uppsc/:category/:slug`, so the checks above see the two hubs and NOTHING
 * beneath them. Every article URL would be invisible to this guard.
 *
 * The registry in `src/lib/articles.ts` is what closes it: it already knows
 * every article's hub, category, slug and status, so the exact set of URLs that
 * SHOULD be crawlable is derivable rather than hand-maintained. That also makes
 * publishing an article a one-field change — flip `status`, and this guard
 * tells you precisely which of the four files still need the URL.
 *
 * Parsed with regex, like every other file here (this runs in CI before
 * `pnpm install`, so it cannot import TypeScript). It FAILS LOUDLY if the shape
 * it depends on moves, rather than silently checking nothing — the same lesson
 * as AUTH_MARKER above.
 */
/**
 * ⚑ ANCHORED TO `export const <NAME>` WITH NO NEWLINE BEFORE THE `=`, and both
 * halves are load-bearing. An earlier cut of this used `${name}[^=]*=\s*\[...\]`,
 * which a negative control caught misbehaving in the worst possible way: with
 * ARTICLE_HUBS renamed, the pattern matched a LATER mention of the name (in a
 * comment, or in `isArticleHub`'s body), then `[^=]*` ran across newlines to the
 * next `= [` it could find and bound "hubs" to the ARTICLE_CATEGORIES array. The
 * guard then cheerfully checked six categories as if they were hubs instead of
 * reporting that it could no longer parse the file — a guard silently checking
 * the wrong thing, which is worse than one that fails.
 */
function listLiteral(name) {
  const m = articlesSrc.match(new RegExp(`export const ${name}[^=\\n]*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const hubs = listLiteral("ARTICLE_HUBS");
const categories = listLiteral("ARTICLE_CATEGORIES");
const publicSources = listLiteral("PUBLIC_DATA_SOURCES");

// One line per entry, so a line carrying `slateRef:` is an article.
const articleLines = articlesSrc.split("\n").filter((l) => l.includes("slateRef:") && l.includes("slug:"));
const field = (line, key) => line.match(new RegExp(`${key}: "([^"]*)"`))?.[1];
const articles = articleLines.map((line) => ({
  slug: field(line, "slug"),
  hub: field(line, "hub"),
  category: field(line, "category"),
  status: field(line, "status"),
  publishedAt: field(line, "publishedAt"),
  updatedAt: field(line, "updatedAt"),
  dataBinding: [...(line.match(/dataBinding: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
}));

if (!hubs?.length || !categories?.length || !publicSources || articles.length === 0) {
  console.error(
    "  ✗ src/lib/articles.ts no longer parses — expected ARTICLE_HUBS / ARTICLE_CATEGORIES / PUBLIC_DATA_SOURCES " +
      "array literals and one-line article entries containing `slateRef:`. This guard cannot check the content hub. " +
      "Update the parser rather than leaving article URLs unchecked.",
  );
  process.exit(1);
}
if (articles.some((a) => !a.slug || !a.hub || !a.category || !a.status)) {
  console.error("  ✗ src/lib/articles.ts: an article entry is missing slug/hub/category/status.");
  process.exit(1);
}
/**
 * ⚑ CROSS-CHECK THE COUNT, because the line-based parse above FAILS SILENTLY.
 * An entry reformatted across several lines (a formatter run, or someone
 * hand-wrapping a long one) matches no single line carrying both markers, so it
 * is simply absent from `articles` — and every check below would then pass
 * while quietly covering fewer articles than the registry declares. That is the
 * exact failure this guard exists to prevent, so it must not be how the guard
 * itself behaves.
 *
 * `slateRef: <digits>` counts real entries and not the interface's own
 * `slateRef: number;` declaration, which carries the word rather than a number.
 */
const declaredArticles = (articlesSrc.match(/slateRef: \d+/g) ?? []).length;
if (articles.length !== declaredArticles) {
  console.error(
    `  ✗ src/lib/articles.ts declares ${declaredArticles} articles but only ${articles.length} could be parsed — ` +
      `an entry is split across lines. This parser needs ONE LINE PER ENTRY; re-join it, or teach the parser to ` +
      `read multi-line entries. Leaving it would silently check fewer articles than exist.`,
  );
  process.exit(1);
}

// 8. Every hub needs BOTH of its router lines. Without this, a hub added to
//    ARTICLE_HUBS with no route 404s in production and nothing fails the build
//    — the config would look complete and the page would not exist.
for (const hub of hubs) {
  if (!router.includes(`{ path: "${hub}", lazy`)) fail(`hub "${hub}" is in ARTICLE_HUBS but has no { path: "${hub}" } route`);
  if (!router.includes(`{ path: "${hub}/:category/:slug", lazy`)) {
    fail(`hub "${hub}" has no { path: "${hub}/:category/:slug" } article route — its articles would 404`);
  }
  for (const locale of ["en", "hi"]) {
    const url = `/${locale}/${hub}`;
    if (!crawlable(url)) fail(`hub ${url} is BLOCKED by robots.txt`);
    if (!inSitemap.has(url)) fail(`hub ${url} is missing from the sitemap`);
    if (!inPrerender.has(url)) fail(`hub ${url} is missing from scripts/prerender.mjs`);
  }
}

// 9. Slug/URL integrity — a typo here is a live 404 that nothing else catches.
const seenPaths = new Set();
for (const a of articles) {
  if (!hubs.includes(a.hub)) fail(`article "${a.slug}" has hub "${a.hub}", which is not in ARTICLE_HUBS`);
  if (!categories.includes(a.category)) {
    fail(`article "${a.slug}" has category "${a.category}", which is not in ARTICLE_CATEGORIES — its URL would 404`);
  }
  const canonical = `${a.hub}/${a.category}/${a.slug}`;
  if (seenPaths.has(canonical)) fail(`two articles resolve to the same URL: ${canonical}`);
  seenPaths.add(canonical);
}

// 10. A PUBLISHED article must be reachable, advertised and snapshotted.
//     A PLANNED one must be in neither the sitemap nor the prerender list.
//
//     Note the asymmetry: `planned` is NOT required to be robots-blocked. The
//     hub's Allow rule is a prefix (`/en/uppsc/`), as it must be for a growing
//     directory, so every article URL is crawlable by construction — and a
//     planned one simply 404s, which is not indexable. What must never happen
//     is ADVERTISING an unwritten page in the sitemap.
for (const a of articles) {
  for (const locale of ["en", "hi"]) {
    const url = `/${locale}/${a.hub}/${a.category}/${a.slug}`;
    if (a.status === "published") {
      if (!crawlable(url)) fail(`published article ${url} is BLOCKED by robots.txt`);
      if (!inSitemap.has(url)) fail(`published article ${url} is missing from the sitemap`);
      if (!inPrerender.has(url)) fail(`published article ${url} is missing from scripts/prerender.mjs`);
    } else {
      if (inSitemap.has(url)) fail(`${url} is status "${a.status}" but advertised in the sitemap — unwritten page`);
      if (inPrerender.has(url)) fail(`${url} is status "${a.status}" but in scripts/prerender.mjs`);
    }
  }
}

// 11. A published article may only bind to data a SIGNED-OUT reader can fetch.
//     This is the check with the most teeth: an article whose headline figure
//     comes from `exam_calendar` or `mv_node_weightage` would render a failed
//     request for exactly the logged-out visitor it was written to attract,
//     because those routers are mounted after requireAuth. Publishing one needs
//     a public endpoint FIRST.
for (const a of articles.filter((x) => x.status === "published")) {
  for (const source of a.dataBinding) {
    if (!publicSources.includes(source)) {
      fail(
        `published article "${a.slug}" binds to "${source}", which has no PUBLIC endpoint — a signed-out reader ` +
          `would get a failed fetch where the figure should be. Expose it before publishing, or drop the binding.`,
      );
    }
  }
}

// 12. A published article needs its dates: BlogPosting's datePublished is
//     required for a valid rich result, and §5.2 requires a visible "updated on"
//     so a stale prerendered snapshot reads as dated rather than as wrong.
for (const a of articles.filter((x) => x.status === "published")) {
  if (!a.publishedAt) fail(`published article "${a.slug}" has no publishedAt — BlogPosting needs datePublished`);
  if (!a.updatedAt) fail(`published article "${a.slug}" has no updatedAt — the page cannot state its own currency`);
  for (const [key, value] of [["publishedAt", a.publishedAt], ["updatedAt", a.updatedAt]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`article "${a.slug}" ${key}="${value}" is not ISO YYYY-MM-DD`);
  }
}

const publishedCount = articles.filter((a) => a.status === "published").length;

if (problems === 0) {
  console.log(
    `✓ SEO guard: ${sitemapUrls.length} sitemap URLs all crawlable and prerendered, ` +
      `${indexable.length} public routes x 2 locales listed, hreflang consistent, app routes still blocked. ` +
      `Content hub: ${hubs.length} hubs routed, ${publishedCount}/${articles.length} articles published and wired.`,
  );
  process.exit(0);
}
console.error(
  `\n${problems} SEO problem(s). robots.txt / sitemap.xml / scripts/prerender.mjs / src/lib/articles.ts must agree.`,
);
process.exit(1);
