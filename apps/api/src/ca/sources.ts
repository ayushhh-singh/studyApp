/**
 * Configured RSS sources for the current-affairs ingestion pipeline
 * (pnpm ca:run — see ./pipeline.ts). Deliberately a plain array so adding/
 * removing/pausing a feed is a one-line edit, no code changes elsewhere.
 *
 * VERIFICATION NOTE (2026-07-06): every URL below was fetched live today
 * before being added. Two categories from the original brief turned out to
 * have no real RSS feed at all, and were substituted rather than shipped as
 * dead links:
 *  - PIB (pib.gov.in): `ViewRss.aspx` is a client-side-rendered Angular shell
 *    — curl (and any non-JS-executing fetcher, i.e. any real RSS reader) gets
 *    back an empty "JavaScript must be enabled" page, not XML, regardless of
 *    the `reg`/`lang` query params. No working feed endpoint could be found.
 *    Substituted with Insights on India's daily current-affairs feed, which
 *    is itself UPSC-exam-curated (frequently digesting PIB releases) and DOES
 *    serve real RSS.
 *  - UP government press releases (information.up.gov.in / up.gov.in): no
 *    RSS link on either site; every guessed /rss path 302-redirects to a 404
 *    error page. Substituted with two genuinely UP-focused regional news
 *    feeds (Hindustan Times Lucknow, IndiaTV Uttar Pradesh) for `isUpSource`.
 * Revisit if either publishes a real feed later.
 */
export interface CaSource {
  id: string;
  name: string;
  feedUrl: string;
  /** Hint fed to the classifier prompt — not authoritative, the model still decides. */
  isUpSource: boolean;
}

export const CA_SOURCES: CaSource[] = [
  {
    id: "the-hindu-national",
    name: "The Hindu — National",
    feedUrl: "https://www.thehindu.com/news/national/feeder/default.rss",
    isUpSource: false,
  },
  {
    id: "indian-express-india",
    name: "The Indian Express — India",
    feedUrl: "https://indianexpress.com/section/india/feed/",
    isUpSource: false,
  },
  {
    id: "livemint-news",
    name: "Livemint — News",
    feedUrl: "https://www.livemint.com/rss/news",
    isUpSource: false,
  },
  {
    id: "insights-on-india-ca",
    name: "Insights on India — Daily Current Affairs",
    feedUrl: "https://www.insightsonindia.com/category/current-affairs-2/feed/",
    isUpSource: false,
  },
  {
    id: "ht-lucknow",
    name: "Hindustan Times — Lucknow",
    feedUrl: "https://www.hindustantimes.com/feeds/rss/cities/lucknow-news/rssfeed.xml",
    isUpSource: true,
  },
  {
    id: "indiatv-uttar-pradesh",
    name: "IndiaTV — Uttar Pradesh",
    feedUrl: "https://www.indiatvnews.com/rssnews/topstory-uttar-pradesh.xml",
    isUpSource: true,
  },
];
