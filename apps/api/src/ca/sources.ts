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
 *
 * ---------------------------------------------------------------------------
 * ⚑ SYLLABUS COVERAGE (2026-08-13) — WHY THIS LIST GREW
 * ---------------------------------------------------------------------------
 * The product owner reported rarely/never seeing current-affairs questions on
 * some syllabus areas (Inflation was the example given, not the whole problem).
 * Measured against the live corpus (5,178 items / 1,808 CA MCQs), the shortfall
 * is real, broad, and NOT caused by triage or by question generation.
 *
 * Per-node, comparing what the real exam asks (published PYQs) against what the
 * CA pipeline has ever produced for that node — `PRE_GS1`, nodes with >=8 PYQs:
 *
 *   node                                   PYQs   CA-MCQs   CA/PYQ
 *   Chemistry                                34         0     0.00
 *   Biology                                  48         6     0.13
 *   Medieval India                           48         7     0.15
 *   Physics                                  18         3     0.17
 *   Ancient India                            30        13     0.43
 *   Demographics                             25        10     0.40
 *   Poverty and Inclusion                    24        11     0.46
 *   Indian National Movement                 21        10     0.48
 *   ...against Public Policy 19 PYQ / 182 CA (9.58) and Science & Tech 24 / 185
 *   (7.71) at the other end — a ~70x spread in how well the pipeline serves one
 *   syllabus node versus another.
 *
 * And a keyword sweep for classic high-yield topics shows how thin the tail is —
 * monetary policy/RBI rates 0 items of 5,178; agriculture MSP 1; fiscal
 * deficit/budget 2; GDP 5; poverty/inequality 5; banking/NPA 6; taxation/GST 7.
 *
 * ⚑ THE CAUSE IS THIS FILE, NOT THE MODEL. Triage demonstrably FAVOURS the
 * missing material when it appears: economy-topic items are archived at 25% vs
 * 42% for everything else and clear the prelims gate at 41% vs 31%. The one
 * clean inflation story in the corpus ("Retail inflation reaches 18-month high
 * of 4.4% in June 2026") scored P2/M3 and produced two MCQs, both of which the
 * reviewer approved. There was simply nothing to triage.
 *
 * The reason is visible in the list itself: every feed was a GENERAL news
 * section (national / India / city / one exam digest). India's economic,
 * scientific and environmental reporting lives in the SUBJECT desks, which none
 * of them carried — note that `livemint-news` is Mint's general `news` feed,
 * not its economy desk, so having a business masthead in the list was not the
 * same as having business coverage.
 *
 * So the feeds below are chosen against the SYLLABUS, one desk per
 * under-served area, rather than by masthead. Each carries the node(s) it is
 * meant to feed. Nothing was removed: the six original feeds still supply the
 * national/state/general spine, and `insights-on-india-ca` is retained (see the
 * caveat on it below).
 *
 * Every URL was fetched live on 2026-08-13 before being committed — real XML,
 * real per-story items, item count and a sample of real headlines recorded.
 * Two candidates were tested and DELIBERATELY NOT ADDED, because authority and
 * volume are not the same as examinability:
 *   - RBI press releases (`rbi.org.in/pressreleases_rss.xml`): 10 items of
 *     operational notices (VRRR auction results, T-bill cut-offs, "Scheduled
 *     Banks' Statement of Position") — procedural, would score 0-1.
 *   - The Hindu Art (`entertainment/art`): 60 items, but gallery listings and
 *     performance reviews, not heritage/archaeology. It does NOT feed Ancient
 *     or Medieval India, which is what that gap actually needs (ASI finds,
 *     UNESCO listings, monument conservation). Those remain under-served and
 *     no clean dedicated feed for them was found — recorded rather than
 *     papered over with a feed that would not have helped.
 *
 * ⚑ CAVEAT ON `insights-on-india-ca`, kept so it is not mistaken for a healthy
 * feed: it contributed 29 items across the entire corpus at a **0% prelims-gate
 * pass rate**, because it publishes ONE DAY-ROLLUP POST per day ("UPSC CURRENT
 * AFFAIRS – 12 AUGUST 2026") covering many topics at once. This pipeline is
 * one-item-one-story end to end — `content_hash` dedupe, per-item triage
 * scoring, and `enrichItem`'s single title/summary all assume it — so a rollup
 * has no single identifiable fact and triage correctly scores it 0-1. It is
 * retained deliberately, but it will keep yielding ~nothing until the pipeline
 * can split one post into many items. **Do not read its low yield as a triage
 * bug, and do not add another digest/rollup feed expecting a different result.**
 */
export interface CaSource {
  id: string;
  name: string;
  feedUrl: string;
  /** Hint fed to the classifier prompt — not authoritative, the model still decides. */
  isUpSource: boolean;
  /**
   * Which syllabus area this desk exists to feed — documentation, NOT behaviour.
   * Nothing reads it: node mapping is decided per item by triage against the real
   * candidate list, and hard-coding a source→node rule here would be worse than
   * the gap it closes (a science desk still carries polity stories). It is
   * recorded so the next person auditing coverage can see what each feed was
   * chosen FOR, and so a feed that stops serving its purpose is noticeable.
   */
  syllabusFocus: string;
}

export const CA_SOURCES: CaSource[] = [
  // --- the original six: the national / state / general spine -------------
  {
    id: "the-hindu-national",
    name: "The Hindu — National",
    feedUrl: "https://www.thehindu.com/news/national/feeder/default.rss",
    isUpSource: false,
    syllabusFocus: "Current Events; Polity & Governance; Public Policy",
  },
  {
    id: "indian-express-india",
    name: "The Indian Express — India",
    feedUrl: "https://indianexpress.com/section/india/feed/",
    isUpSource: false,
    syllabusFocus: "Current Events; Polity & Governance; Social Sector",
  },
  {
    id: "livemint-news",
    name: "Livemint — News",
    feedUrl: "https://www.livemint.com/rss/news",
    isUpSource: false,
    syllabusFocus: "Current Events (Mint's general news desk, NOT its economy desk)",
  },
  {
    id: "insights-on-india-ca",
    name: "Insights on India — Daily Current Affairs",
    feedUrl: "https://www.insightsonindia.com/category/current-affairs-2/feed/",
    isUpSource: false,
    // Retained deliberately — but see the CAVEAT in the header: this publishes
    // one day-ROLLUP per day, so it yields ~nothing until the pipeline can split
    // a post into items. Its 0% pass rate is structural, not a triage bug.
    syllabusFocus: "Exam-curated digest (structurally under-served — see header)",
  },
  {
    id: "ht-lucknow",
    name: "Hindustan Times — Lucknow",
    feedUrl: "https://www.hindustantimes.com/feeds/rss/cities/lucknow-news/rssfeed.xml",
    isUpSource: true,
    syllabusFocus: "UP-specific (GS5_UP / GS6_UP; is_up_specific)",
  },
  {
    id: "indiatv-uttar-pradesh",
    name: "IndiaTV — Uttar Pradesh",
    feedUrl: "https://www.indiatvnews.com/rssnews/topstory-uttar-pradesh.xml",
    isUpSource: true,
    syllabusFocus: "UP-specific (GS5_UP / GS6_UP; is_up_specific)",
  },

  // --- subject desks, added 2026-08-13 against the per-node gaps above -----
  // Economy. Verified live: 60 items, per-story, carrying exactly the material
  // the corpus was missing — "Retail inflation hits 19-month high of 4.45% in
  // July 2026 as food, fuel prices rise", Fitch's India rating, UPI MDR policy,
  // PSB bad-loan write-offs.
  {
    id: "the-hindu-economy",
    name: "The Hindu — Business / Economy",
    feedUrl: "https://www.thehindu.com/business/Economy/feeder/default.rss",
    isUpSource: false,
    syllabusFocus: "Economic Development; Economic & Social Development; Poverty and Inclusion",
  },
  // Economy. Carries monetary-policy reporting specifically ("RBI policy panel
  // likely to keep interest rates unchanged … amid oil, inflation risks") — the
  // single emptiest topic in the sweep, at 0 items of 5,178.
  //
  // ⚑ DEEP BUT SLOW, measured 2026-08-13: the feed holds 200 items, but they
  // span MONTHS (newest Aug 2, then Jul 31, Jul 22, Jul 13 …), so under the
  // default `--days 3` freshness window it contributes ZERO on most runs. That
  // is not a broken feed and not a reason to drop it — with rotation an empty
  // source costs nothing and yields its share to the others — but do not read
  // "200 items" as a daily firehose. `the-hindu-economy` (13 fresh items in the
  // same 3-day window) is the economy workhorse; this one is the specialist that
  // shows up when it publishes.
  {
    id: "indian-express-economy",
    name: "The Indian Express — Business / Economy",
    feedUrl: "https://indianexpress.com/section/business/economy/feed/",
    isUpSource: false,
    syllabusFocus: "Economic Development; taxation/GST; external sector; banking",
  },
  // Science. Feeds Biology (48 PYQs but CA/PYQ 0.13) and Science & Technology.
  // Verified live: 60 items, and the sample is exactly the examinable shape —
  // "NASA invites ISRO to join Moon Base programme", "Three new cascade frog
  // species discovered in northeast India" (a `species` fact kind).
  {
    id: "the-hindu-science",
    name: "The Hindu — Science",
    feedUrl: "https://www.thehindu.com/sci-tech/science/feeder/default.rss",
    isUpSource: false,
    syllabusFocus: "Biology; Physics; Chemistry; Science & Technology Developments",
  },
  // Environment. Feeds Ecology & Biodiversity, Environmental Policy &
  // Conservation, Climate Change. Verified live: 60 items, named-entity dense —
  // "Kaziranga Eco-Sensitive Zone", "Shompen tribe", "Aravallis", new frog
  // species — which is precisely what the prelims gate rewards.
  {
    id: "the-hindu-environment",
    name: "The Hindu — Energy & Environment",
    feedUrl: "https://www.thehindu.com/sci-tech/energy-and-environment/feeder/default.rss",
    isUpSource: false,
    syllabusFocus: "Ecology & Biodiversity; Environmental Policy & Conservation; Climate Change",
  },
  // Explainers. Not a subject desk, but the highest-yield SHAPE in the test set:
  // 200 items of durable, self-contained background written to explain rather
  // than report ("How UPI became India's biggest digital payments system",
  // "What the parliamentary probe panel found") — i.e. the opposite of the
  // transient-state items the triage gate now scores down. Spans every paper
  // rather than serving one node.
  {
    id: "indian-express-explained",
    name: "The Indian Express — Explained",
    feedUrl: "https://indianexpress.com/section/explained/feed/",
    isUpSource: false,
    syllabusFocus: "Cross-syllabus durable background (Polity, Economy, Sci-Tech, IR)",
  },
];
