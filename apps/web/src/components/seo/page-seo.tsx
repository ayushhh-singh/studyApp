import { useEffect, type ComponentType, type PropsWithChildren } from "react";
import { Helmet as HelmetBase } from "react-helmet-async";

// react-helmet-async's React-18 class-component types don't satisfy React 19's
// JSX component type (works fine at runtime); cast to a children-only component.
const Helmet = HelmetBase as unknown as ComponentType<PropsWithChildren>;
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/locale";
// One definition, shared with lib/structured-data.ts — a canonical tag and a
// JSON-LD `item` URL resolving to different origins on a preview deploy is the
// kind of split that looks identical in development and is punished in search.
import { SITE_URL } from "@/lib/site-url";

/**
 * Only meant for genuinely public, unauthenticated routes (landing, pricing)
 * — the crawlable surface of an otherwise sign-in-gated SPA. Every other
 * route is behind requireAuth and has no reason to be indexed.
 *
 * title/description are set via direct DOM mutation of index.html's static
 * <title>/<meta name="description"> tags, NOT react-helmet-async — Helmet
 * only manages tags it renders itself and doesn't remove/replace pre-existing
 * static ones, so routing both through Helmet left two of each in the DOM
 * (duplicate <title>, duplicate meta description) with undefined "which one
 * wins" behavior for crawlers. Helmet is still used below for the tags that
 * have no static counterpart (canonical/hreflang/og/twitter) — no conflict
 * there since index.html never defines those.
 */
export function PageSeo({
  locale,
  path,
  title,
  description,
  structuredData,
  ogType = "website",
  publishedTime,
  modifiedTime,
}: {
  locale: Locale;
  /** Path WITHOUT the locale prefix, e.g. "" for the landing page, "/pricing" for pricing. */
  path: string;
  title: string;
  description: string;
  /**
   * Optional JSON-LD, rendered as a <script type="application/ld+json">.
   *
   * Accepts an ARRAY as well as a single object because one page can carry
   * several graphs — a content-hub article is both a BlogPosting and a
   * BreadcrumbList — and JSON-LD permits a top-level array. Passing two
   * separate <script> tags would also work; one array keeps them adjacent and
   * unambiguously about the same page.
   */
  structuredData?: object | object[];
  /**
   * `og:type`. Defaults to "website", which was previously hardcoded and is
   * right for the landing/pricing/feature pages — but wrong for an article,
   * where "article" is what unlocks the published/modified time properties
   * below and tells a social preview it is looking at a piece of writing
   * rather than a site.
   */
  ogType?: "website" | "article";
  /** ISO date. Emitted only for ogType="article"; ignored otherwise. */
  publishedTime?: string;
  /** ISO date. Emitted only for ogType="article"; ignored otherwise. */
  modifiedTime?: string;
}) {
  const canonical = `${SITE_URL}/${locale}${path}`;
  const ogImage = `${SITE_URL}/og-default-${locale}.png`;

  useEffect(() => {
    const previousTitle = document.title;
    const descTag = document.querySelector('meta[name="description"]');
    const previousDescription = descTag?.getAttribute("content") ?? null;

    document.title = title;
    descTag?.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null) descTag?.setAttribute("content", previousDescription);
    };
  }, [title, description]);

  return (
    <Helmet>
      <link rel="canonical" href={canonical} />
      {SUPPORTED_LOCALES.map((l) => (
        <link key={l} rel="alternate" hrefLang={l} href={`${SITE_URL}/${l}${path}`} />
      ))}
      <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}/${DEFAULT_LOCALE}${path}`} />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:locale" content={locale === "hi" ? "hi_IN" : "en_IN"} />
      {/* Only meaningful under og:type="article" — emitting them on a website
          page would be inert at best and contradictory at worst. */}
      {ogType === "article" && publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {ogType === "article" && modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      {structuredData && <script type="application/ld+json">{JSON.stringify(structuredData)}</script>}
    </Helmet>
  );
}
