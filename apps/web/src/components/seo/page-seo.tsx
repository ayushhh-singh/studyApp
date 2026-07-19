import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/locale";

/**
 * VITE_SITE_URL lets a real deploy override this; every dev/preview build
 * without it set falls back to the production domain so canonical/OG URLs
 * are at least well-formed rather than pointing at localhost in a shared
 * build artifact.
 */
const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://neevstudy.com").replace(/\/$/, "");

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
}: {
  locale: Locale;
  /** Path WITHOUT the locale prefix, e.g. "" for the landing page, "/pricing" for pricing. */
  path: string;
  title: string;
  description: string;
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
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:locale" content={locale === "hi" ? "hi_IN" : "en_IN"} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
