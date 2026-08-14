/**
 * The canonical origin for every absolute URL this app emits — canonical links,
 * hreflang alternates, OG tags and JSON-LD.
 *
 * Extracted so there is exactly ONE definition. It previously lived inside
 * `components/seo/page-seo.tsx`, which was fine while that file was the only
 * thing emitting absolute URLs; the moment structured data started carrying
 * `item`/`mainEntityOfPage` URLs, a second copy appeared and the two could
 * disagree on a preview deploy (where VITE_SITE_URL is set) while looking
 * identical in development. A canonical tag and a BreadcrumbList pointing at
 * different origins is precisely the kind of split a crawler punishes.
 *
 * VITE_SITE_URL lets a real deploy override it; a dev/preview build without it
 * set falls back to the production domain so URLs are at least well-formed
 * rather than pointing at localhost inside a shared build artifact.
 */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://neevstudy.com").replace(
  /\/$/,
  "",
);
