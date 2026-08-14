/**
 * The content hub's article registry — `docs/content-strategy.md` §4's slate,
 * encoded.
 *
 * SHAPE. Deliberately the same shape as `lib/features.ts`: a flat array of
 * one-line entries that drives the routes, the hub grids, the internal-linking
 * order AND the crawlable surface. `/features` is the working precedent (config
 * -> one detail route -> prerender list -> sitemap -> robots); this is that
 * pattern one level deeper, which is exactly how §6.1 framed it.
 *
 * TWO FIELDS `features.ts` DOES NOT HAVE, each earning its place:
 *
 *  - `status`. A feature page always has content because the feature exists. An
 *    ARTICLE does not exist until someone writes it, and §9.2 ("who writes
 *    them?") is still an open founder decision. Without a status flag the only
 *    way to stage that is to hand-edit four SEO files per article, which is the
 *    exact drift `scripts/check-seo.mjs` was built to stop. So the slate lives
 *    here in full from day one and `status` decides what is REAL: only
 *    `published` entries reach the router, the sitemap, robots.txt and the
 *    prerender list. A `planned` entry is a commitment recorded in code, not a
 *    thin page shipped to Google.
 *
 *  - `dataBinding`. §5's core rule is "don't hand-write a date that drifts
 *    stale" — an article states its numbers by READING them, not by freezing
 *    them into an i18n string. Declaring the binding here (rather than burying
 *    it in the route component) makes it checkable: `check:seo` refuses to
 *    publish an article bound to a source that has no PUBLIC endpoint, because
 *    a signed-out reader would get a 401 where the number should be.
 *
 * PUBLISHING STARTED 2026-08-14. Everything shipped dark until then — the same
 * way the trial, test-series and guest work shipped dark in this repo before it
 * — and a `planned` entry still means exactly what it meant on day one: a
 * commitment recorded in code, 404ing and advertised nowhere. `check:seo`
 * reports the live count on every run, so the honest answer to "how much of
 * this is real?" is a build step rather than a comment that goes stale.
 */

/**
 * A hub is an EXAM, and its slug is the real `exams.exam_code`. That identity is
 * load-bearing, not cosmetic: it is what lets a hub page bind straight to the
 * public `GET /exams` registry for its own paper structure instead of restating
 * a pattern that only the registry can keep true (`0106` seeded that table from
 * each commission's own notification PDF).
 *
 * Exam-first hubs mirror the structure that is demonstrably working for the
 * only well-funded competitor in this space (§1a): the hub is itself a rankable
 * asset and accumulates internal link equity from every article beneath it. A
 * flat `/blog/<slug>` throws that away.
 */
export const ARTICLE_HUBS = ["uppsc", "upsc"] as const;
export type ArticleHub = (typeof ARTICLE_HUBS)[number];

/**
 * Five of these six are the categories observed in the wild on SuperKalam
 * (§1a). `analysis` is ours and is the whole point: the Tier-2 data pieces are
 * the one category no competitor can write, because none of them holds 5,246
 * real past-year questions mapped onto both commissions' syllabus trees (§2c).
 * It gets its OWN accumulating category rather than being folded into
 * `resources` precisely because it is the differentiator — burying the moat
 * under a generic label spends it.
 *
 * `career-guidance` carries no slate item yet. It stays in the taxonomy because
 * it is a real, observed category (eligibility/attempts/service-allocation
 * explainers) and §4's own bench names one — adding it later must not need a
 * URL change.
 */
export const ARTICLE_CATEGORIES = [
  "exam-updates",
  "analysis",
  "books",
  "resources",
  "strategy",
  "career-guidance",
] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

/**
 * `planned` = in the slate, no prose, NOT routed and NOT crawlable.
 * `published` = live prose in both locales, routed, sitemapped, prerendered.
 *
 * There is deliberately no `draft` state between them. A half-written article
 * is a `planned` one; anything reachable is finished, because "reachable but
 * thin" is the single worst outcome for a hub whose entire pitch is accuracy.
 */
export type ArticleStatus = "planned" | "published";

/**
 * Which live data an article reads rather than hard-codes (§5).
 *
 * ⚑ THE PUBLIC/PRIVATE SPLIT IS A REAL CONSTRAINT, NOT BOOKKEEPING, and it is
 * the thing §5 glossed. `GET /exams` is mounted BEFORE `requireAuth`; every
 * other source below sits behind it (`apps/api/src/index.ts` — the public
 * routers are health, billing-plans, guest-auth and exams, and nothing else).
 * So an article that binds to `exam_calendar` or `mv_node_weightage` today
 * would render its headline number as a failed fetch for exactly the
 * signed-out reader it was written to attract — and the prerendered snapshot a
 * crawler reads would carry the empty state permanently.
 *
 * That is not a reason to hard-code the number (§5 is right that a frozen date
 * is worse). It is a prerequisite: publishing any article marked with a
 * non-public source requires exposing that source publicly first. `check:seo`
 * enforces this rather than trusting this comment.
 */
export const ARTICLE_DATA_SOURCES = [
  "exam_registry",
  "exam_calendar",
  "node_weightage",
  "syllabus_nodes",
  "exam_cutoffs",
  "question_bank",
] as const;
export type ArticleDataSource = (typeof ARTICLE_DATA_SOURCES)[number];

/**
 * The subset reachable without a session. Keep in step with `apps/api/src/index.ts`.
 *
 * `exam_calendar` and `node_weightage` joined this list on 2026-08-14, when
 * `contentHubPublicRouter` was added to serve them — and the ORDER of that work
 * is the point of the guard: `check:seo` rule 11 would have failed the build on
 * the first article that bound to either, so the endpoint had to exist before
 * the prose could ship rather than after a signed-out reader found a blank
 * figure where the headline number belonged.
 *
 * `syllabus_nodes`, `exam_cutoffs` and `question_bank` are still auth-only.
 */
export const PUBLIC_DATA_SOURCES: readonly ArticleDataSource[] = [
  "exam_registry",
  "exam_calendar",
  "node_weightage",
];

export interface ArticleDef {
  /** URL slug — the last segment of /:locale/<hub>/<category>/<slug>. */
  slug: string;
  hub: ArticleHub;
  category: ArticleCategory;
  /** i18n key under the "Articles" namespace, e.g. Articles.<i18nKey>.metaTitle. */
  i18nKey: string;
  status: ArticleStatus;
  /** Live sources this article reads instead of freezing a number into prose (§5). */
  dataBinding: readonly ArticleDataSource[];
  /** §4 slate number, so a page traces back to the reasoning that commissioned it. */
  slateRef: number;
  /**
   * ISO `YYYY-MM-DD`. Absent while `planned`; REQUIRED once `published`, and
   * `check:seo` enforces that — a BlogPosting with no `datePublished` is a
   * malformed rich result, and an article with no visible "updated on" line
   * cannot satisfy §5.2 (a stale prerendered snapshot must read as honestly
   * dated rather than as wrong).
   *
   * Hand-set at publish time rather than derived from the file's git history:
   * `updatedAt` must move when the PROSE is revised, not when an unrelated
   * refactor touches the route component that renders every article.
   */
  publishedAt?: string;
  updatedAt?: string;
}

/**
 * ORDER IS §4's PUBLISHING SEQUENCE (1 -> 2 -> 5 -> 3 -> 4, then 6 -> 7 -> 13 ->
 * 9 -> 8, then the rest), not the slate's numbering. It doubles as hub display
 * order, which is what we want: the highest-intent, most defensible pages sit
 * at the top of the hub rather than the earliest-numbered ones.
 *
 * ⚑ A "Both exams" slate item still needs ONE canonical URL, because the URL
 * carries the hub. All four cross-exam pieces (#8, #9, #12, and the CSAT work)
 * canonicalise to `uppsc` and are cross-linked from `upsc`, on §1b/§1c's
 * evidence: the UPSC field is contested by well-funded incumbents while the
 * UPPSC depth tier is empty and its Hindi intent is being served by Google
 * Translate proxies. The winnable hub gets the canonical.
 */
/**
 * ⚑ TWO SLATE TITLES CARRIED A YEAR; THE SHIPPED SLUGS DO NOT, and the reason is
 * that our page is not the same KIND of page as the one it competes with.
 *
 * §4 named these "UPPSC PCS 2027 …" and "UPSC CSE 2027 …", copying the format
 * SuperKalam re-cuts annually (§1a lists two 2027 date pages plus a 2026 calendar
 * page for the same exam). A competitor must re-cut, because their date is typed
 * into the page: when the cycle turns, the old URL is stale and a new one has to
 * be minted. Ours READS the date (§5), so one URL stays correct across cycles —
 * and a yearless URL accumulates link equity for the life of the exam instead of
 * splitting it across a new page every year.
 *
 * For UPPSC there is a second, harder reason. Migration 0126 records that no
 * official UPPSC 2027 date exists in any form (UPPSC publishes its calendar in
 * January, and announces Mains only after the Prelims result), so a page titled
 * "UPPSC PCS 2027 exam date" would have had no 2027 date to show — the exact
 * gap between title and content that an accuracy-led hub cannot afford.
 */
export const ARTICLES: ArticleDef[] = [
  // --- Tier 1: evergreen, highest intent (§4). Ships first. -----------------
  { slug: "uppsc-pcs-exam-date-timeline-and-exam-pattern", hub: "uppsc", category: "exam-updates", i18nKey: "uppscExamDate", status: "published", dataBinding: ["exam_calendar", "exam_registry"], slateRef: 1, publishedAt: "2026-08-14", updatedAt: "2026-08-14" },
  { slug: "upsc-cse-exam-date-timeline-and-structure", hub: "upsc", category: "exam-updates", i18nKey: "upscExamDate", status: "published", dataBinding: ["exam_calendar", "exam_registry"], slateRef: 2, publishedAt: "2026-08-14", updatedAt: "2026-08-14" },
  { slug: "uppsc-mains-2023-restructure-what-gs-v-and-gs-vi-ask", hub: "uppsc", category: "exam-updates", i18nKey: "uppscMainsRestructure", status: "published", dataBinding: ["node_weightage", "exam_registry"], slateRef: 5, publishedAt: "2026-08-14", updatedAt: "2026-08-14" },
  { slug: "uppsc-pcs-booklist-2027-prelims-and-mains", hub: "uppsc", category: "books", i18nKey: "uppscBooklist2027", status: "planned", dataBinding: [], slateRef: 3 },
  { slug: "upsc-cse-booklist-2027-prelims-and-mains", hub: "upsc", category: "books", i18nKey: "upscBooklist2027", status: "planned", dataBinding: [], slateRef: 4 },

  // --- Tier 2: the data moat (§2c). Nobody else holds the questions. --------
  { slug: "what-uppsc-prelims-actually-tests-by-the-numbers", hub: "uppsc", category: "analysis", i18nKey: "uppscPrelimsWeightage", status: "planned", dataBinding: ["node_weightage"], slateRef: 6 },
  { slug: "what-upsc-prelims-actually-tests-by-the-numbers", hub: "upsc", category: "analysis", i18nKey: "upscPrelimsWeightage", status: "planned", dataBinding: ["node_weightage"], slateRef: 7 },
  { slug: "what-uppsc-mains-actually-asks-by-topic-frequency", hub: "uppsc", category: "analysis", i18nKey: "uppscMainsWeightage", status: "planned", dataBinding: ["node_weightage"], slateRef: 13 },
  { slug: "uppsc-vs-upsc-same-syllabus-words-different-exams", hub: "uppsc", category: "analysis", i18nKey: "uppscVsUpsc", status: "planned", dataBinding: ["node_weightage", "syllabus_nodes", "exam_registry"], slateRef: 9 },
  { slug: "csat-by-the-numbers-uppsc-and-upsc", hub: "uppsc", category: "analysis", i18nKey: "csatByTheNumbers", status: "planned", dataBinding: ["node_weightage", "question_bank"], slateRef: 8 },

  // --- Tier 3: supporting evergreen (§4). -----------------------------------
  { slug: "uppsc-pcs-syllabus-2027-paper-by-paper", hub: "uppsc", category: "resources", i18nKey: "uppscSyllabus", status: "planned", dataBinding: ["syllabus_nodes", "exam_registry"], slateRef: 10 },
  { slug: "upsc-cse-syllabus-paper-by-paper", hub: "upsc", category: "resources", i18nKey: "upscSyllabus", status: "planned", dataBinding: ["syllabus_nodes", "exam_registry"], slateRef: 11 },
  { slug: "ncerts-for-uppsc-and-upsc-which-ones-pay", hub: "uppsc", category: "books", i18nKey: "ncertsThatPay", status: "planned", dataBinding: [], slateRef: 12 },
  { slug: "starting-uppsc-from-zero-a-12-month-plan", hub: "uppsc", category: "strategy", i18nKey: "uppscFromZero", status: "planned", dataBinding: ["exam_calendar"], slateRef: 14 },
  { slug: "uppsc-prelims-cutoffs-and-answer-keys", hub: "uppsc", category: "exam-updates", i18nKey: "uppscCutoffs", status: "planned", dataBinding: ["exam_cutoffs"], slateRef: 15 },
];

/** Locale-prefixed URL for an article. The single place the URL shape is built. */
export function articlePath(a: ArticleDef, locale: string): string {
  return `/${locale}/${a.hub}/${a.category}/${a.slug}`;
}

/** Locale-prefixed URL for a hub. */
export function hubPath(hub: ArticleHub, locale: string): string {
  return `/${locale}/${hub}`;
}

export function isArticleHub(value: string | undefined): value is ArticleHub {
  return ARTICLE_HUBS.includes(value as ArticleHub);
}

/**
 * The hub out of a pathname, or undefined if the second segment is not one.
 *
 * ⚑ WHY THIS EXISTS RATHER THAN A `:hub` ROUTE PARAM. The router declares the
 * hubs as LITERAL segments (`uppsc`, `uppsc/:category/:slug`, and the same pair
 * for `upsc`) instead of one `:hub/:category/:slug`. A leading dynamic segment
 * would match every unmatched one-segment path under /:locale — so `/en/typo`
 * would resolve to the hub route and depend on its loader to 404, instead of
 * falling through to the wildcard that already does that job correctly. Two
 * literal pairs cost four router lines and cannot shadow anything.
 *
 * The cost is that the matched route has no `:hub` param to read, so it is
 * recovered from the path. That is safe precisely BECAUSE the route only
 * matches those literals — and `check:seo` asserts every hub in ARTICLE_HUBS
 * has both of its router lines, so a hub added here without a route fails the
 * build rather than 404ing silently in production.
 */
export function hubFromPathname(pathname: string): ArticleHub | undefined {
  // "/en/uppsc/analysis/slug" -> ["", "en", "uppsc", ...]
  const segment = pathname.split("/")[2];
  return isArticleHub(segment) ? segment : undefined;
}

/**
 * Resolves a route's three params to an article — and returns undefined unless
 * ALL THREE agree, so `/uppsc/books/<an-analysis-slug>` 404s instead of quietly
 * serving the right article at a URL that is not its canonical one. Duplicate
 * content at two URLs is the specific SEO failure that would cost us here.
 *
 * A `planned` article resolves to undefined too: the route exists, but nothing
 * unwritten is reachable.
 */
export function getPublishedArticle(
  hub: string | undefined,
  category: string | undefined,
  slug: string | undefined,
): ArticleDef | undefined {
  return ARTICLES.find(
    (a) => a.status === "published" && a.hub === hub && a.category === category && a.slug === slug,
  );
}

export function publishedArticles(): ArticleDef[] {
  return ARTICLES.filter((a) => a.status === "published");
}

export function publishedArticlesForHub(hub: ArticleHub): ArticleDef[] {
  return ARTICLES.filter((a) => a.status === "published" && a.hub === hub);
}

/** Categories that actually have something to show under a hub, in taxonomy order. */
export function activeCategoriesForHub(hub: ArticleHub): ArticleCategory[] {
  const live = new Set(publishedArticlesForHub(hub).map((a) => a.category));
  return ARTICLE_CATEGORIES.filter((c) => live.has(c));
}
