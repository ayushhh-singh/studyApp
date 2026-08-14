import { SITE_URL } from "./site-url";

/**
 * JSON-LD builders for the content hub.
 *
 * No new plumbing, per `docs/content-strategy.md` §6.4: `PageSeo` already takes
 * a `structuredData` object and already renders one on two pages (`FAQPage` on
 * feature-detail, `Organization` on the landing page). These are the same
 * pattern — plain objects handed to the same prop. The only widening needed was
 * accepting an ARRAY, because an article legitimately carries two graphs at
 * once (BlogPosting + BreadcrumbList) and JSON-LD allows a top-level array.
 *
 * ⚑ EVERY FIELD HERE MUST BE REAL. This repo's standing rule for marketing
 * surfaces — no invented `sameAs` profiles, no fabricated ratings, no author
 * persona that does not exist. Google penalises structured data that
 * contradicts the page, and a hub whose entire pitch is accuracy cannot be the
 * place that starts.
 */

/** The publisher identity, kept identical to the landing page's Organization schema. */
const PUBLISHER = {
  "@type": "Organization",
  name: "Neev",
  alternateName: "नींव",
  url: SITE_URL,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/pwa/icon-512.png` },
} as const;

export interface BreadcrumbCrumb {
  name: string;
  /** Locale-prefixed path, e.g. "/en/uppsc". */
  path: string;
}

/**
 * BreadcrumbList — tells Google the hub/category/article hierarchy the URL
 * scheme already encodes, so the rendered result shows
 * "neevstudy.com > UPPSC PCS > …" instead of a bare URL. It is also the
 * cheapest way to make the hub itself visible as a parent entity in search,
 * which is the entire reason §6.2 chose hub-first URLs.
 */
export function breadcrumbList(crumbs: BreadcrumbCrumb[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}

/**
 * BlogPosting for one article.
 *
 * `datePublished` is required for a valid rich result, which is why
 * `check:seo` refuses to let an article reach `status: "published"` without
 * one. `dateModified` matters more here than on a typical blog: these pages
 * carry live figures, and a reader who sees a stale prerendered snapshot needs
 * the page to say when it was last true (§5.2).
 *
 * `author` is the Organization, not a person — because that is the truth. The
 * slate is agent-drafted and founder-edited (§9.2), so inventing a bylined
 * human author would be a fabricated credential on a page selling accuracy.
 */
export function blogPosting(args: {
  headline: string;
  description: string;
  /** Locale-prefixed path, e.g. "/en/uppsc/analysis/slug". */
  path: string;
  datePublished: string;
  dateModified: string;
  locale: string;
}): object {
  const url = `${SITE_URL}${args.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: args.headline,
    description: args.description,
    datePublished: args.datePublished,
    dateModified: args.dateModified,
    inLanguage: args.locale === "hi" ? "hi-IN" : "en-IN",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    image: `${SITE_URL}/og-default-${args.locale}.png`,
    author: PUBLISHER,
    publisher: PUBLISHER,
  };
}
