# Content hub — SEO strategy for both exams

**Status: PLAN ONLY. No article has been written and no route, sitemap entry or
robots rule has been added.** Everything below is either a measured fact (with the
query that produced it) or a proposal awaiting sign-off. §9 lists the decisions
that are the founder's, not this document's.

Written 2026-08-14. Every competitor claim in §1 was verified by fetching the page
or by search on that date, not from memory; every number in §2 came from a
read-only query against the live database on that date.

---

## §0 The one-paragraph version

Mirror the hub-and-category structure that is demonstrably working for SuperKalam
(§1a), but run it for **both** exams and in **both** languages, because that is
where the competitive field is thinnest (§1b, §1c). Lead with the three evergreen
formats that competitors re-cut every single year — exam date/timeline, yearly
booklist, rule-change explainer — because annual re-publication is revealed
preference and the strongest ranking signal available without a keyword tool
(§3). Then build a moat nobody can copy: this app has **5,246 published real
past-year questions mapped onto both commissions' own syllabus trees**, 96–100% of
them attached to a specific syllabus topic, so it can publish what each exam
*actually* tests, by the numbers, across 8 and 11 years (§2c). That is a category
of article no competitor in this space currently publishes, for the simple reason
that none of them has the data.

---

## §1 The competitive read

### 1a. What SuperKalam actually does — verified 2026-08-14

The brief described "~30 pages across 4 hubs". The observable structure is close
but worth stating exactly, because the **URL shape is the part worth copying**:

| | |
|---|---|
| Hubs | `/upsc-preparation`, `/upsc-prelims`, `/upsc-mains`, `/current-affairs` |
| Article URL | `/upsc-preparation/<category>/<slug>` |
| Categories seen in the wild | `resources`, `strategy`, `books`, `career-guidance`, `exam-updates` |
| Current-affairs URL | `/current-affairs/articles/<slug>` |
| Scale | large, and **mostly current affairs** — see the note below |

⚑ **Do not quote a total article count from this document.** Reading their
pagination controls gave "30 pages" on `/upsc-preparation` and "125 pages" on
`/upsc-mains`, and a pagination control usually shows the *last* page number, so
these are lower bounds at best and were read by a model, not counted. The brief's
"~30 pages of articles" is very likely an undercount of the whole site. What *is*
safely observable, and is the strategically useful part: **their volume is the
current-affairs treadmill; their evergreen set is small.** That is the split this
plan deliberately inverts (§8).

The load-bearing observation is **not** the article count. It is that a hub page
is itself a rankable asset (`/upsc-prelims` targets "UPSC Prelims preparation"),
and each article sits at `hub/category/slug` so the hub accumulates internal link
equity from every article beneath it. A flat `/blog/<slug>` throws that away.

**Their evergreen winners are visible in what they re-cut annually.** These all
exist as separate live URLs:

- `/upsc-preparation/exam-updates/upsc-2027-exam-date-timeline-vacancy-and-eligibility`
- `/upsc-preparation/exam-updates/upsc-cse-2027-date-timeline-exam-structure-and-syllabus`
- `/upsc-preparation/exam-updates/upsc-calendar-2026-exam-dates-and-details`
- `/upsc-preparation/resources/upsc-cse-2027-booklist-best-books-for-prelims-and-mains`
- `/upsc-preparation/books/complete-upsc-book-list-for-2026-best-books-for-prelims-and-mains`
- `/upsc-preparation/books/ncert-6th-to-12th-booklist-for-upsc-preparation-a-subject-wise-guide`
- `/upsc-preparation/career-guidance/upsc-new-rules-for-reattempts-and-service-restrictions-a-guide-for-upsc-2027-aspirants`

Two date/timeline pages for the *same* exam cycle, plus a calendar page, plus two
booklists a year apart, plus a rule-change explainer. Nobody spends that
repeatedly on formats that do not earn.

**Their book coverage is review-only.** They write at length about Laxmikanth
(`/upsc-preparation/resources/laxmikanth-polity-an-indispensable-resource-for-upsc`)
and publish full booklists, and link to no PDF of any copyrighted title. This
confirms — as industry-standard practice, not as overcaution — the line this repo
independently arrived at on 2026-08-13 while building `/resources`: **review the
book, never host or link the book.** See §7.

### 1b. The UPPSC field — the brief's premise, corrected

The brief called UPPSC "a real gap". That is **directionally right and literally
too strong**, and the difference changes what we should write.

What is true: **no state-PCS hub surfaced on SuperKalam's own hub pages or in any
search run for this document.** Their entire site is UPSC. The AI-first,
depth-first tier of this market has not entered UPPSC.

What is *not* true is that UPPSC content is absent. It is served, but by two
populations, neither of which is hard to beat on depth:

1. **National aggregators** — Testbook, Careers360, CollegeDekho, StudyIQ,
   Adda247, Edukemy. High domain authority, templated pages, thin and largely
   interchangeable; they rank on authority rather than on being good.
2. **Small regional coaching blogs** — Analytics IAS, Legacy IAS, Prep IQ, Target
   PCS Lucknow. Genuinely UPPSC-specific and often more useful than the
   aggregators, but low authority and inconsistent.

So the opportunity is not virgin ground. It is that **the depth tier is empty**:
nobody is combining specialist UPPSC knowledge with real authority and real data.

### 1c. The sharpest single finding: Hindi is served by machine translation

Searching the Hindi-language UPPSC intent (`यूपीपीएससी पीसीएस तैयारी रणनीति बुकलिस्ट`)
returns, among the top results, **`translate.google.com/translate?u=...` proxies of
Drishti IAS and BYJU's English pages.**

Google surfacing a translation proxy for a query is a direct statement that native
coverage of that intent is thin enough that a machine translation of an English
page is among the best things it can find. For an exam where a very large share of
candidates prepare in Hindi, that is the most actionable signal in this document.

This app is bilingual by architecture — `/:locale/*` routing, hreflang alternates
already wired, Devanagari as first-class typography with its own font pipeline, and
a standing convention that Hindi is written natively rather than translated. Nothing
new has to be built to compete here. It only has to be used.

**Caveat, stated because it is the risk:** Hindi articles must be *authored* in
Hindi, not translated from the English draft. Shipping machine-translated Hindi
would put us in exactly the bucket we are trying to beat, and would be
indistinguishable to a reader from the Google Translate proxies above. See
`docs/OUTSTANDING.md` §2 **B8** (the Devanagari line-height row — note there is a
second, unrelated B8 under §9b) — a live typography defect that would also need
fixing before shipping long-form Hindi prose.

---

## §2 What we can say that competitors cannot

Every figure here was measured on 2026-08-14 against the live database. These are
the counts as of that date and will move; §5 covers how an article stays true.

### 2a. The bank

⚑ **`source` matters and must never be blurred in public copy.** The bank holds
**5,934** published + review-approved questions, but only **5,246 are real
past-year questions** (`source='pyq'`); the other **688 are AI-generated practice
items**. An article may say "5,246 real UPPSC and UPSC questions" or "5,934
questions to practise". It may **never** call the 5,934 figure PYQs — 289 of
UPPSC's CSAT items and 118 of its General Hindi items are generated, so the error
would be largest exactly where a reader is most likely to check.

Real past-year questions only:

| | UPPSC | UPSC |
|---|---|---|
| Prelims GS-I | 1,005 | 1,089 |
| Prelims CSAT | 599 | 860 |
| Mains GS papers | 760 (GS1–GS6) | 731 (GS1–GS4) |
| Essay | 72 | 80 |
| General Hindi | 50 | — |
| **Total real PYQs** | **2,486** | **2,760** |
| *(plus generated practice)* | *622* | *66* |

**"Answer-key-verified" is a Prelims-MCQ claim, not a bank-wide one.** Of the 3,553
published Prelims PYQs across both exams, **3,552 carry `answer_key_verified`** —
so the claim is true and strong, but it must be scoped to Prelims. Mains
descriptive questions have no key to verify; UPSC publishes none at all.

**Year coverage** (published + approved, `source='pyq'`, exact counts):

- UPPSC — 2018:223 · 2019:339 · 2020:347 · 2021:341 · 2022:198 · 2023:382 ·
  2024:369 · 2025:287 → **8 years**
- UPSC — 2016:262 · 2017:262 · 2018:260 · 2019:267 · 2020:258 · 2021:256 ·
  2022:258 · 2023:257 · 2024:256 · 2025:257 · 2026:167 → **11 years**

Plus **362 published, fact-audited study chapters** (UPPSC 284 of 294 syllabus
nodes; UPSC 78 of 202) and **3,265 published current-affairs items** (archive
begins 2026-07-05).

### 2b. ⚑ One data hole that must be disclosed before it is published

**UPPSC Prelims GS-I 2022 is ingested but effectively unpublished: 150 questions
in, 1 published.** Every other UPPSC GS-I year publishes 132–150 of 150.

```
2018: 133/150   2019: 150/150   2020: 150/150   2021: 144/150
2022:   1/150   2023: 145/145   2024: 132/150   2025: 150/150
```

That is the documented consequence of 2022 having no verified answer key (see
CLAUDE.md's CSAT key-provenance work — 2022 is the one year that resolved to
"genuinely unresolvable"). CSAT 2022 is fine at 100 published.

Two consequences, and neither is optional:

1. **Any UPPSC Prelims weightage article covers 7 of 8 years, not 8.** It must say
   so, in the article, next to the chart. This product's entire differentiator is
   that its numbers are real; a silently missing year would be the one mistake
   that costs more than the article earns.
2. **The `/learn` → Trends view already has this hole, live, today.** That is a
   pre-existing product finding this content work surfaced, not something the
   content work causes. Worth a founder decision independent of publishing (§9.5).

### 2c. The moat — real weightage, per section, per year

Rolled up from `mv_node_weightage` to depth-1 sections. UPPSC covers 7 years
(2022 missing per §2b); UPSC covers 11.

**UPPSC Prelims GS-I — 986 mapped questions**

| Share | Count | Section |
|---|---|---|
| 15.9% | 157 | History of India and Indian National Movement |
| 15.7% | 155 | Indian Polity and Governance |
| 15.3% | 151 | Indian and World Geography |
| 14.6% | 144 | Economic and Social Development |
| 14.0% | 138 | Current Events of National and International Importance |
| 12.9% | 127 | General Science |
| 11.6% | 114 | Environmental Ecology, Bio-diversity and Climate Change |

**UPSC Prelims GS-I — 1,057 mapped questions**

| Share | Count | Section |
|---|---|---|
| 19.2% | 203 | Indian Polity and Governance |
| 17.5% | 185 | Economic and Social Development |
| 16.6% | 175 | History of India and Indian National Movement |
| 13.6% | 144 | General Science |
| 12.5% | 132 | Environmental Ecology, Bio-diversity and Climate Change |
| 11.0% | 116 | Current Events of National and International Importance |
| 9.6% | 102 | Indian and World Geography |

**The headline finding, and it is genuinely counter-intuitive: UPPSC Prelims is
flat and UPSC Prelims is skewed.** UPPSC's seven sections span 11.6%–15.9%, a
**4.3-point** spread — no section is optional, and the widely-repeated coaching
advice to "drop" a section is, on eight years of real papers, wrong for this exam.
UPSC's span 9.6%–19.2%, a **9.6-point** spread — Polity is genuinely twice
Geography.

Two more findings that fall straight out of the by-year series and are each worth
an article section:

- **UPSC Geography is rising, hard.** 2016–2021 totals 39 questions (6.5/year);
  2022–2026 totals 63 (12.6/year). The lowest-share section of the last decade is
  not the lowest-share section of the last five years.
- **UPSC Current Events is the most volatile thing on the paper** — 22 in 2016,
  down to 3–5 across 2019–2021, back to 21 in 2026. Any "X% of the paper is
  current affairs" claim that quotes a single number is describing one year.

**Two properties of `mv_node_weightage` that make all of the above safe to publish,
both checked rather than assumed:**

- It is defined `where ... is_published and review_state = 'approved' and source = 'pyq'`
  (migration `0037`), so **generated practice questions are excluded by
  construction**. These percentages describe what the commission asked, not what
  we produced. Nothing in §2a's generated-vs-PYQ hazard reaches this section.
- Its `exam_code` is question **provenance**, which this repo warns can differ from
  the node's exam (the domain includes `up_ro_aro`, `upsssc_pet`). Measured: every
  paper's nodes carry only their own exam's code — UPPSC's 986 are all `uppsc`,
  UPSC's 1,057 all `upsc`. No cross-exam blending.

⚑ **Correction — Mains weightage is READY, and an earlier draft of this document
said the opposite.** That draft computed UPPSC MAINS_GS2 as 148 mapped of 198
"published" and concluded ~75% coverage, therefore "needs a mapping pass first".
The 198 denominator included 50 generated questions the matview correctly excludes.
Against the right denominator the real figures are:

| | Prelims | Mains |
|---|---|---|
| UPPSC | 96.7% – 98.1% | **99.0% – 100%** |
| UPSC | 97.1% – 97.8% | **96.5% – 100%** |

Mains node-mapping is **as good as or better than Prelims**, not worse. MAINS_GS2,
GS3, GS4, GS6, Essay and General Hindi are all at 100%. So a Mains-weightage
article needs no preparatory work — and it is arguably the *better* differentiator,
because Mains topic frequency cannot be eyeballed from a paper the way a Prelims
count can, and nobody publishes it. It is in the slate at §4 #13.

### 2d. Assets already built that articles can point at

- **`/resources`** — 81 NCERT textbook editions and 8 official government sources,
  every URL verified by **content** (magic bytes) rather than status code, with
  real file sizes shown. 752 links re-verified 2026-08-13. Competitors' "free
  resources" pages are link lists that rot; ours is checked at build time.
- **`/pyq-archive`** and per-year print-to-PDF over our own bank — the answer to
  "download UPPSC previous year papers", which is otherwise a dead end because
  UPPSC's own `Open_PDF.aspx` cold-bounces to its homepage for anyone without a
  session cookie.
- **Publisher-verified reference-book research, already done.** 13 core + 4
  UP-specific titles verified against the publisher's own product page with ISBN
  and price (2026-08-13), including three findings competitors get wrong: McGraw
  Hill renamed its whole UPSC line to *"Courseware on …"* in 2025 so title-matching
  the coaching lists misses the current product; amazon.in 500s on automated
  fetch so retailer links are unverifiable; and **Drishti's "उत्तर प्रदेश एक परिचय"
  does not exist**. This research is reusable as-is, which is why the two booklist
  articles in §4 are cheap.

---

## §3 How the slate is prioritized — and the honest limit

**There is no keyword-volume data behind this document.** No Ahrefs/Semrush/Keyword
Planner access was used, so any "monthly searches" figure here would be invented.
Ranking is instead on four signals that *were* observed:

1. **Competitor repetition (strongest).** A page a well-funded competitor re-cuts
   every year is a page that earns every year. Applies to exam-date/timeline,
   yearly booklists, and rule-change explainers.
2. **SERP composition.** Where the first page is aggregator-templated (all UPPSC
   queries run for this document), depth beats authority eventually. Where it is
   already specialist-dense, it does not.
3. **Query repeat rate.** An aspirant checks "when is the exam" many times across a
   cycle; they read "how to write an essay" once. Both are evergreen; only one
   compounds.
4. **Language gap (§1c).** Hindi UPPSC intent is served by translation proxies.

**Recommendation: buy keyword data before Tier 2.** Tier 1 is safe on revealed
preference alone. Beyond that, guessing gets expensive.

---

## §4 The initial slate

15 articles. Every one bilingual by architecture (`/en/*` + `/hi/*` + hreflang);
the **authoring** language order differs by tier and is called out. "Data-bound"
means the page reads live app data rather than hard-coding a number — see §5.

### Tier 1 — evergreen, highest intent, ship first (5)

| # | Article | Exam | Category | Notes |
|---|---|---|---|---|
| 1 | **UPPSC PCS 2027: exam date, timeline, eligibility and pattern** | UPPSC | `exam-updates` | Data-bound to `exam_calendar`. **Hindi first.** The single highest-repeat query in the set. Our 2026 Prelims date (2026-12-06, non-tentative) is already seeded and verified. |
| 2 | **UPSC CSE 2027: exam date, timeline and full structure** | UPSC | `exam-updates` | Data-bound. We already hold **both** 2027 dates as non-tentative — Prelims 2027-05-23 and Mains 2027-08-20 — which is more than most competitor pages state. |
| 3 | **UPPSC PCS booklist 2027 — Prelims + Mains, Hindi and English medium** | UPPSC | `books` | Cheap: publisher research done (§2d). **Hindi first.** The medium split is the differentiator; most booklists are English-only. |
| 4 | **UPSC CSE booklist 2027 — Prelims + Mains** | UPSC | `books` | Same research base. Directly contests a page SuperKalam re-cuts annually. |
| 5 | **UPPSC Mains after the 2023 restructure: what GS-V and GS-VI actually ask** | UPPSC | `exam-updates` | ⚑ **The unique one.** Optionals removed, two compulsory UP-specific GS papers added. We hold the pre-reform (2018–2022) and post-reform (2023–2025) papers *content-mapped onto one tree*, so we can show what changed with questions rather than assert it. Nobody else can. |

### Tier 2 — the data moat (4)

| # | Article | Exam | Category | Notes |
|---|---|---|---|---|
| 6 | **What UPPSC Prelims actually tests, by the numbers (2018–2025)** | UPPSC | `analysis` | Data-bound to `mv_node_weightage`. Lead with the flat-distribution finding (§2c). **Must disclose the 2022 gap (§2b).** |
| 7 | **What UPSC Prelims actually tests, by the numbers (2016–2026)** | UPSC | `analysis` | Data-bound. Lead with the skew, plus Geography rising and Current Events volatility. |
| 8 | **CSAT by the numbers: what 1,459 real questions show about the qualifying paper** | Both | `analysis` | 599 UPPSC + 860 UPSC **real PYQs** — the published CSAT totals are 888 and 902, but 331 of those are generated practice (§2a). High intent (CSAT panic is perennial) and we hold the largest key-verified corpus either exam has. |
| 9 | **UPPSC vs UPSC: same syllabus words, different exams** | Both | `analysis` | Only possible because both banks are mapped to comparable structures. Also the natural conversion page for the aspirant preparing for both — a real and common audience nobody writes for. |

### Tier 3 — supporting evergreen (6)

*(#13 is a Tier-2-class `analysis` piece that landed here only because it was added
after the §2c correction; it is sequenced with Tier 2, not with this tier.)*

| # | Article | Exam | Category | Notes |
|---|---|---|---|---|
| 10 | **UPPSC PCS syllabus 2027, explained paper by paper** | UPPSC | `resources` | Data-bound to `syllabus_nodes` (294 nodes, ingested from the official PDF). **Hindi first.** |
| 11 | **UPSC CSE syllabus, explained paper by paper** | UPSC | `resources` | Data-bound to the 202-node hand-authored, coverage-gated tree (`docs/upsc-syllabus-coverage.md`) — every line traceable to the official notification. |
| 12 | **NCERTs for UPPSC and UPSC: which ones actually pay — with free official links** | Both | `books` | Links into `/resources`' 81 verified editions. Competitors' equivalents link to pirated PDFs or to rotted URLs; ours are content-verified with sizes. |
| 13 | **What UPPSC Mains actually asks: six GS papers by topic frequency** | UPPSC | `analysis` | ⚑ Added late, after the §2c correction showed Mains mapping is 99–100%, not the ~75% an earlier draft had computed. Harder to eyeball than Prelims and published by nobody, so arguably the strongest single data piece here. Pairs directly with #5. |
| 14 | **Starting UPPSC from zero: a 12-month plan anchored to the real 2027 timeline** | UPPSC | `strategy` | Data-bound countdown. Differentiator: every generic "12-month plan" is undated; ours counts back from the actual seeded date. |
| 15 | **UPPSC Prelims cut-offs and answer keys: what the official record says** | UPPSC | `exam-updates` | Backed by `exam_cutoffs` (20 official rows, GS-I by year and category) plus our per-year key-provenance data. Includes the honest part competitors omit: which years' official keys are actually retrievable and which are not. |

**Sequencing.** 1 → 2 → 5 → 3 → 4 (Tier 1 first, with #5 pulled forward because it
is the most defensible and least contested page in the whole slate), then 6 → 7 →
13 → 9 → 8, then the rest of Tier 3 as capacity allows.

**Next off the bench, not in the 15.** *UPPSC PCS eligibility, age limit and
attempts* was in an earlier cut of this slate and was dropped when #13 was added.
It is high-repeat evergreen, but it is a **fact lookup** where our data adds
nothing and Careers360/Testbook win on authority alone — which is exactly the case
§3's own reasoning says depth does *not* beat authority. Worth writing once the
hubs have their own authority; not worth leading with. Also on the bench: a
**monthly** current-affairs compilation built from the magazine editions we already
compile (§8), and a UPSC Mains counterpart to #13.

---

## §5 Freshness — "don't hand-write a date that drifts stale"

This is the requirement that most shapes the build, so it gets its own section.

**The mechanism.** An article is a route component: static prose plus **live data
slots** that read from the API (`GET /exams`, `exam_calendar`, weightage). A real
visitor's browser always renders current truth, because `main.tsx` calls
`createRoot().render()` and React replaces the prerendered markup wholesale.

**The catch, stated precisely.** `scripts/prerender.mjs` produces a **build-time
CSR snapshot**. So the HTML a non-JS crawler reads is only as fresh as the last
deploy — and Cloudflare Pages builds on push, with **no scheduled rebuild workflow
in the repo today** (checked: the 11 workflows in `.github/workflows/` include no
deploy trigger). An article published today and untouched for four months would
show a crawler a four-month-old snapshot.

**Three things close that, and all three are needed:**

1. **A scheduled rebuild.** One `schedule:`-triggered GitHub Action hitting a
   Cloudflare Pages deploy hook, weekly. No Node, no install, near-zero cost — and
   the pattern is already established here, since **10 of the repo's 11 workflows
   are already `schedule:`-triggered**; this would be the first one that deploys.
   ⚑ Note the standing trap: scheduled workflows run from the **default branch**,
   and this repo has already been bitten by `origin/main` lagging (CLAUDE.md §U8k).
2. **Every data-bound page states its own "as of" date and source, on the page.**
   A stale snapshot then reads as honestly dated rather than as wrong. This is the
   same rule the app already applies to provisional answer keys.
3. **`lastmod` must be generated, not hand-written.** The existing sitemap already
   had a blanket hand-set `lastmod` that was wrong for rewritten pages; the fix
   read each route's own `git log -1`. For a data-bound article, source-file mtime
   is *insufficient* — the page changes when the DATA changes. Generate `lastmod`
   as `max(source commit date, data-refresh date)`.

**Do not** hard-code a date, a question count, or a weightage percentage into an
i18n string. Both message files are already large and shared with a concurrent
session; a number frozen in `hi.json` is a number nobody will ever remember to
update.

---

## §6 Infrastructure this needs

Nothing here is exotic — `/features` is the working precedent (a `FEATURES`
config → one `feature-detail` route → prerender list → sitemap → robots). The
blog is that pattern, one level deeper.

1. **Route + config.** `lib/articles.ts` in the shape of `lib/features.ts`
   (slug, hub, category, i18n key, data-binding), plus hub, category and detail
   routes. Public — declared **before** the `require-auth` subtree, since
   `check-seo.mjs` derives "public route" from exactly that boundary.
2. **URL scheme — exam-first hubs, mirroring what works (§1a):**
   `/:locale/uppsc` and `/:locale/upsc` (hubs) · `/:locale/<exam>/<category>/<slug>`.
   Categories: `exam-updates`, `strategy`, `books`, `resources`, `career-guidance`,
   and a new `analysis` for the Tier-2 data pieces — its own category, not a
   sub-case of `resources`, because it is the differentiator and deserves a hub
   that accumulates.
3. **The four-file rule.** `robots.txt` + `sitemap.xml` + `prerender.mjs` + the
   router must be edited together — a page in the sitemap but not in robots is
   advertised to Google *and* forbidden to it, which has already happened here
   twice. `pnpm --filter web check:seo` fails the build on that combination and
   will cover the new routes for free; a `/uppsc/` + `/upsc/` **prefix** Allow rule
   (like `/features/`) is right for a directory that will grow.
4. **Two small `PageSeo` changes.** `og:type` is hardcoded `"website"` — an article
   needs `"article"`. And `structuredData` already exists and is already used twice
   — `FAQPage` on `feature-detail.tsx` and `Organization` on `landing.tsx` — so
   `BlogPosting` + `BreadcrumbList` need no new plumbing. (The `Organization`
   schema is also the other half of the logo-in-search story the robots fix
   addressed, so articles linking back to the landing page reinforce it.)
5. **Prerender scale.** 38 routes today; 15 bilingual articles plus hubs takes it
   past 70 Playwright page loads per build. Fine, but worth watching — and the
   Cloudflare postbuild path already wraps this in try/catch and always exits 0, so
   a prerender failure degrades to "no snapshot" rather than a failed deploy.
6. **Hindi typography.** `docs/OUTSTANDING.md` §2 **B8**: Tailwind's `text-sm`/`text-xs`
   line-heights beat the `:root[data-locale="hi"]` 1.75 rule, app-wide. Tolerable
   in UI chrome; **not** tolerable in long-form Devanagari prose. Fix before Hindi
   articles ship, not after.

---

## §7 The legal line

**Review the book. Never host or link the book.** Confirmed as industry-standard
practice, not overcaution — SuperKalam writes a full Laxmikanth review and links no
PDF (§1a).

- Reference books are in copyright. Every "free UPSC book PDF" site an aspirant
  finds is distributing pirated copies of exactly the titles our booklists name.
  Link the **publisher's** product page (verified with ISBN and price), never a
  retailer we cannot verify and never a file.
- **NCERT forbids rehosting in its own terms**, verbatim: *"No website or online
  service is permitted to host these online textbooks."* We link NCERT's own URLs
  and never merge, mirror or proxy them. This is already enforced in `lib/resources.ts`
  — no type there has a download field, and its header says why.
- Old NCERTs (R.S. Sharma, Satish Chandra, Bipan Chandra) are out of print, still
  in copyright, and NCERT has no archive. **They may be named and reviewed and must
  never be linked.**

---

## §8 Deliberately not proposed

- **Daily current-affairs articles.** SuperKalam's highest-volume format
  (`/current-affairs/articles/*`). Skipped: it is a treadmill competing with
  Drishti and Vision at their own game, it spends crawl budget on pages that decay
  in weeks, and we already generate current affairs *in-app*. A **monthly**
  compilation built from the magazine editions we already compile is the better
  phase-2 move.
- **UPSC optional-subject content.** ~25 subjects × 2 papers; we hold zero data and
  the syllabus tree explicitly excludes them.
- **Topper interviews / "how I cleared it".** We have no toppers. Fabricating or
  aggregating them is the one thing that would undermine an accuracy-led brand.
- **Result-day and answer-key news posts.** Same-day publishing against
  organisations that staff for it.
*(An earlier draft also excluded **Mains weightage** here, on a node-mapping figure
that turned out to be computed against the wrong denominator. It is corrected in
§2c and is now slate item #13.)*

---

## §9 Decisions for the founder

1. **Hindi-first or English-first for the UPPSC Tier 1?** This document recommends
   **Hindi first** for #1, #3, #10 on the §1c evidence, which is a real change in
   authoring effort. English-first is the safer default if Hindi authoring capacity
   is the constraint.
2. **Who writes them?** The chapter pipeline (agent-authored → fact-audited →
   human-approved) exists and is proven over 362 chapters at $0 API spend. It is
   reusable here — but marketing copy carries brand voice in a way a study chapter
   does not, and a hallucinated exam date on a public page is a different class of
   error from one inside a syllabus chapter. Recommendation: **agent-drafted,
   founder-edited, and every date/number data-bound rather than written.**
3. **URL scheme** — `/:locale/<exam>/<category>/<slug>` as proposed, or a flat
   `/:locale/blog/<slug>`? Recommendation as in §6.2; the hubs are the point.
4. **Cadence and stopping point.** 15 articles is a slate, not a strategy. Decide
   now whether this is a one-time push or an ongoing program, because §5's
   scheduled-rebuild and freshness machinery is only worth building for the latter.
5. **The 2022 UPPSC Prelims GS-I key gap (§2b).** Independent of publishing: 149 of
   150 real questions are sitting unpublished, and the live `/learn` Trends view
   already shows a 7-of-8-year series. Worth deciding whether to chase a verified
   2022 key before article #6 quotes the series.
6. **Buy keyword data before Tier 2?** (§3.) Tier 1 stands on revealed preference;
   past that, prioritization is inference.

---

## Sources

- [SuperKalam — UPSC Preparation hub](https://superkalam.com/upsc-preparation)
- [SuperKalam — UPSC 2027 exam date, timeline, vacancy and eligibility](https://superkalam.com/upsc-preparation/exam-updates/upsc-2027-exam-date-timeline-vacancy-and-eligibility)
- [SuperKalam — UPSC CSE 2027 booklist](https://superkalam.com/upsc-preparation/resources/upsc-cse-2027-booklist-best-books-for-prelims-and-mains)
- [SuperKalam — NCERT 6th to 12th booklist](https://superkalam.com/upsc-preparation/books/ncert-6th-to-12th-booklist-for-upsc-preparation-a-subject-wise-guide)
- [SuperKalam — UPSC new rules for reattempts](https://superkalam.com/upsc-preparation/career-guidance/upsc-new-rules-for-reattempts-and-service-restrictions-a-guide-for-upsc-2027-aspirants)
- [SuperKalam — blog / current affairs hub](https://superkalam.com/blog)
- [Testbook — UPPSC PCS books 2026](https://testbook.com/uppcs/best-books-for-preparation)
- [Analytics IAS — UPPSC PCS preparation from zero 2026](https://analyticsias.com/uppsc-pcs-preparation-from-zero-2026/)
- [Legacy IAS — UPPSC 2026–2027 complete book list](https://www.legacyias.com/uppcs-2026-2027-complete-book-list-prelims-mains/)
- [StudyIQ — UPPSC exam pattern](https://www.studyiq.com/articles/uppsc-exam-pattern/)
- [Testbook — UPPSC Mains syllabus](https://testbook.com/uppcs/mains-syllabus)
- [Careers360 — UP PCS 2025 exam, cutoff, answer key](https://competition.careers360.com/exams/up-pcs)
- [CollegeDekho (Hindi) — UPPSC PCS syllabus 2026](https://www.collegedekho.com/hi/articles/uppsc-pcs-syllabus-in-hindi/)
- [StudyIQ (Hindi) — UPPSC syllabus in Hindi](https://www.studyiq.com/articles/uppsc-syllabus-in-hindi/)
