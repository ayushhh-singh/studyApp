import type { TargetExamCode } from "@neev/shared";

/**
 * The FREE study-material directory behind /:locale/resources.
 *
 * ── THIS FILE LINKS TO FREE, OFFICIALLY-PUBLISHED MATERIAL ONLY ──────────────
 * Everything here is published free by the body that owns it — NCERT for the
 * textbooks, the relevant ministry/department for the reports — and every entry
 * points at that body's OWN site. Two consequences, both deliberate:
 *
 *   - We never mirror or re-host a file. Linking out means a reader always gets
 *     whatever the publisher currently serves, and it keeps Neev out of the
 *     business of hosting textbook bytes at all.
 *   - There is no field on any type here for a paid book's PDF, and none may be
 *     added. The standard commercial references (Laxmikanth, Spectrum, Leong,
 *     Ramesh Singh …) are copyrighted; every "free UPSC book PDF" site an
 *     aspirant lands on is distributing pirated copies of exactly those titles,
 *     and a real product cannot link into that. If a curated buy-it-here
 *     directory is wanted later it belongs in its own module with a `buyUrl`
 *     and no download field — not as a flag on these types.
 *
 * ── EVERY URL WAS FETCHED AND VERIFIED, NOT PATTERN-GUESSED ──────────────────
 * Government sites routinely answer a dead path with HTTP 200 and an HTML
 * "not found"/homepage body rather than a 404 — this repo has been bitten by
 * exactly that (a bare `upsc.gov.in` host returns `200 text/html` for a PDF
 * path that only resolves under `www.`). So an entry is listed only if a fetch
 * returned real content of the expected KIND. When re-verifying, check the
 * content-type and the body; never the status code alone.
 */

/** Subject buckets — one filter row drives the whole page. */
export const RESOURCE_SUBJECTS = [
  "social_science",
  "history",
  "polity",
  "geography",
  "economy",
  "society",
  "art_culture",
  "science_tech",
  "environment",
  "state_focus",
] as const;
export type ResourceSubject = (typeof RESOURCE_SUBJECTS)[number];

/**
 * A free, officially-published NCERT textbook.
 *
 * Stored as NCERT's own BOOK CODE rather than as a URL, because the URL scheme
 * is the verified thing: every file lives at `/textbook/pdf/<code>…` as a plain
 * static asset. Keeping the code means the scheme is written down once
 * ({@link ncertBookUrl}) instead of being re-typed 81 times.
 *
 * DO NOT link `textbook.php?<code>=0-N`. That page is a 500KB client-rendered
 * shell — it returns byte-identical HTML for every book and contains no PDF
 * anchors at all, so it looks fine to a human with JS and is useless to
 * everything else. The `/textbook/pdf/` files are static and need no JS.
 *
 * `codeHi` is the separately-published Hindi edition, which NCERT issues as its
 * own book with its own code and its own chapter count — on a Hindi-first
 * product that is a first-class resource, not a translation footnote. 32 of
 * these 39 books have one; the rest genuinely do not.
 */
export interface NcertBook {
  /** Stable React key — the English book code. */
  id: string;
  /** NCERT class, 6-12. */
  klass: number;
  subject: ResourceSubject;
  /** NCERT's own English title for the book. */
  title: string;
  /** NCERT's book code, e.g. `lehs1`. */
  code: string;
  /** Verified chapter count. Chapter n is `<code><nn>.pdf`. */
  chapters: number;
  /** The Hindi edition's own code, when NCERT publishes one. */
  codeHi?: string;
  /** The Hindi edition's own chapter count. */
  chaptersHi?: number;
  /** Measured size of the complete-book download, in bytes. */
  bytes: number;
  /** Measured size of the Hindi complete-book download, in bytes. */
  bytesHi?: number;
}

/**
 * Human download size, shown on every download control.
 *
 * Not decoration: these files run from 8MB to 201MB (measured across all 81
 * editions, median 22MB) and this audience is largely on metered mobile data.
 * A download button with no size on it is a trap on a 201MB book.
 */
export function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

/** NCERT's static asset root. Both `ncert.nic.in` and `www.` serve it identically. */
const NCERT_PDF_ROOT = "https://ncert.nic.in/textbook/pdf";

/**
 * The complete book, as NCERT's own "Download complete book" button serves it.
 *
 * ⚑ IT IS A ZIP, AND THAT IS NOT AN OVERSIGHT ON OUR PART — NCERT PUBLISHES NO
 * WHOLE-BOOK PDF. Verified three ways: their own textbook.php JS writes
 * `<a href='../textbook/pdf/<code>dd.zip'>Download complete book</a>` and
 * nothing else; every plausible whole-book PDF suffix (`.pdf`, `dd.pdf`,
 * `00.pdf`, `bk.pdf`, `full.pdf`, `an.pdf`) 404s; ePathshala's domain refuses
 * connections and DIKSHA serves the same books as chapter collections.
 *
 * ⚑ AND WE MAY NOT BUILD ONE. NCERT's terms of use, verbatim from that same
 * page: "republication of NCERT textbooks by any other individual or agency is
 * strictly prohibited. No agency or individual may make electronic or print
 * copies of these books and redistribute them in any form whatsoever. Use of
 * these online books as a part of digital content packages or software is also
 * strictly prohibited. No website or online service is permitted to host these
 * online textbooks." Merging the chapter PDFs and serving the result — from an
 * endpoint, a cache, or a build step — is exactly what that forbids. Apps that
 * do offer a single NCERT PDF are hosting unauthorised copies; that is why they
 * can offer what NCERT itself does not. Do not add a merge endpoint here.
 *
 */
export function ncertBookUrl(code: string): string {
  return `${NCERT_PDF_ROOT}/${code}dd.zip`;
}

/**
 * A single chapter, as a direct PDF.
 *
 * Offered ALONGSIDE the complete-book zip rather than instead of it, because
 * the two solve different problems: the zip is one file but needs an unzip app,
 * and a chapter PDF opens natively in one tap. That matters most on exactly the
 * books where the zip is worst — 15 of the 81 editions are over 50MB and the
 * largest is 201MB, which is not a realistic download on metered mobile data.
 *
 * The chapter scheme is verified, not extrapolated: every chapter of every book
 * shipped here was magic-byte checked (591 files), and NCERT answers a missing
 * one with a genuine 404 rather than a soft-404 body, so a withdrawn book fails
 * loudly. Chapter n is zero-padded: `<code>01.pdf`.
 */
export function ncertChapterUrl(code: string, chapter: number): string {
  return `${NCERT_PDF_ROOT}/${code}${String(chapter).padStart(2, "0")}.pdf`;
}

/**
 * Free material published by the government itself — Economic Survey, ministry
 * reports, statistical releases. Same "free and official" tier as NCERT, but
 * not a textbook with a class, hence its own type.
 */
export interface OfficialResource {
  id: string;
  subject: ResourceSubject;
  title: string;
  /** Who publishes it — rendered as the provenance line, so the source is visible. */
  publisher: string;
  /** Verified official link. */
  url: string;
  /**
   * Which target exams this is relevant to. A state exam's own budget/survey is
   * not something a national-exam aspirant reads, so the list is scoped rather
   * than shown to everyone as noise.
   */
  exams: TargetExamCode[];
  /** True for state-government material — rendered with its own badge. */
  stateSpecific?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────

export const NCERT_BOOKS: NcertBook[] = [
  { id: "fees1", klass: 6, subject: "social_science", title: "Exploring Society: India and Beyond", code: "fees1", chapters: 14, bytes: 211000479, codeHi: "fhes1", chaptersHi: 14, bytesHi: 59186977 },
  { id: "gees1", klass: 7, subject: "social_science", title: "Exploring Society: India and Beyond Part-I", code: "gees1", chapters: 12, bytes: 83271333, codeHi: "ghes1", chaptersHi: 12, bytesHi: 95063761 },
  { id: "gees2", klass: 7, subject: "social_science", title: "Exploring Society: India and Beyond Part-II", code: "gees2", chapters: 8, bytes: 48990352, codeHi: "ghes2", chaptersHi: 8, bytesHi: 48204689 },
  { id: "hees1", klass: 8, subject: "social_science", title: "Exploring Society: India and Beyond Part-I", code: "hees1", chapters: 7, bytes: 48094564, codeHi: "hhes1", chaptersHi: 7, bytesHi: 56239490 },
  { id: "hees2", klass: 8, subject: "social_science", title: "Exploring Society: India and Beyond Part-II", code: "hees2", chapters: 8, bytes: 50138601 },
  { id: "iest1", klass: 9, subject: "social_science", title: "Understanding Society: India and Beyond Part-I", code: "iest1", chapters: 9, bytes: 70903864 },
  { id: "hess2", klass: 8, subject: "history", title: "Our Pasts-III", code: "hess2", chapters: 8, bytes: 51786237, codeHi: "hhss1", chaptersHi: 8, bytesHi: 88973474 },
  { id: "jess3", klass: 10, subject: "history", title: "India and the Contemporary World-II", code: "jess3", chapters: 5, bytes: 29113574, codeHi: "jhss3", chaptersHi: 5, bytesHi: 27534400 },
  { id: "kehs1", klass: 11, subject: "history", title: "Themes in World History", code: "kehs1", chapters: 7, bytes: 29255011, codeHi: "khhs1", chaptersHi: 7, bytesHi: 23807853 },
  { id: "lehs1", klass: 12, subject: "history", title: "Themes in Indian History-I", code: "lehs1", chapters: 4, bytes: 23177241, codeHi: "lhhs1", chaptersHi: 4, bytesHi: 26081004 },
  { id: "lehs2", klass: 12, subject: "history", title: "Themes in Indian History-II", code: "lehs2", chapters: 4, bytes: 24034378, codeHi: "lhhs2", chaptersHi: 4, bytesHi: 22827601 },
  { id: "lehs3", klass: 12, subject: "history", title: "Themes in Indian History-III", code: "lehs3", chapters: 4, bytes: 15820340, codeHi: "lhhs3", chaptersHi: 4, bytesHi: 17286461 },
  { id: "hess3", klass: 8, subject: "polity", title: "Social and Political Life", code: "hess3", chapters: 8, bytes: 23045559, codeHi: "hhss3", chaptersHi: 8, bytesHi: 21630127 },
  { id: "jess4", klass: 10, subject: "polity", title: "Democratic Politics", code: "jess4", chapters: 5, bytes: 13370156, codeHi: "jhss4", chaptersHi: 5, bytesHi: 11949122 },
  { id: "keps1", klass: 11, subject: "polity", title: "Political Theory", code: "keps1", chapters: 8, bytes: 18007623, codeHi: "khps1", chaptersHi: 8, bytesHi: 18258205 },
  { id: "keps2", klass: 11, subject: "polity", title: "Indian Constitution at Work", code: "keps2", chapters: 10, bytes: 29415398, codeHi: "khps2", chaptersHi: 10, bytesHi: 28959602 },
  { id: "leps1", klass: 12, subject: "polity", title: "Contemporary World Politics", code: "leps1", chapters: 7, bytes: 42004000, codeHi: "lhps1", chaptersHi: 7, bytesHi: 14746599 },
  { id: "leps2", klass: 12, subject: "polity", title: "Politics in India Since Independence", code: "leps2", chapters: 8, bytes: 40873539, codeHi: "lhps2", chaptersHi: 8, bytesHi: 31412689 },
  { id: "hess4", klass: 8, subject: "geography", title: "Resource and Development", code: "hess4", chapters: 5, bytes: 11909208, codeHi: "hhss4", chaptersHi: 5, bytesHi: 11717124 },
  { id: "jess1", klass: 10, subject: "geography", title: "Contemporary India", code: "jess1", chapters: 7, bytes: 15381006, codeHi: "jhss1", chaptersHi: 7, bytesHi: 13937173 },
  { id: "kegy1", klass: 11, subject: "geography", title: "India Physical Environment", code: "kegy1", chapters: 6, bytes: 10719225, codeHi: "khgy1", chaptersHi: 6, bytesHi: 8544900 },
  { id: "kegy2", klass: 11, subject: "geography", title: "Fundamentals of Physical Geography", code: "kegy2", chapters: 14, bytes: 13768078, codeHi: "khgy2", chaptersHi: 14, bytesHi: 16342575 },
  { id: "kegy3", klass: 11, subject: "geography", title: "Practical Work in Geography", code: "kegy3", chapters: 6, bytes: 13592042, codeHi: "khgy3", chaptersHi: 6, bytesHi: 18040043 },
  { id: "legy1", klass: 12, subject: "geography", title: "Fundamentals of Human Geography", code: "legy1", chapters: 8, bytes: 24177649, codeHi: "lhgy1", chaptersHi: 8, bytesHi: 15770490 },
  { id: "legy2", klass: 12, subject: "geography", title: "India People and Economy", code: "legy2", chapters: 9, bytes: 15598014, codeHi: "lhgy2", chaptersHi: 9, bytesHi: 15288967 },
  { id: "legy3", klass: 12, subject: "geography", title: "Practical Work in Geography Part-II", code: "legy3", chapters: 4, bytes: 8758757 },
  { id: "jess2", klass: 10, subject: "economy", title: "Understanding Economic Development", code: "jess2", chapters: 5, bytes: 16429387, codeHi: "jhss2", chaptersHi: 5, bytesHi: 14466833 },
  { id: "keec1", klass: 11, subject: "economy", title: "Indian Economic Development", code: "keec1", chapters: 8, bytes: 27257382, codeHi: "khec1", chaptersHi: 8, bytesHi: 14445757 },
  { id: "kest1", klass: 11, subject: "economy", title: "Statistics for Economics", code: "kest1", chapters: 8, bytes: 14737979, codeHi: "khst1", chaptersHi: 8, bytesHi: 13062844 },
  { id: "leec1", klass: 12, subject: "economy", title: "Introductory Macroeconomics", code: "leec1", chapters: 6, bytes: 10906706, codeHi: "lhec1", chaptersHi: 6, bytesHi: 10547997 },
  { id: "leec2", klass: 12, subject: "economy", title: "Introductory Microeconomics", code: "leec2", chapters: 5, bytes: 12905954, codeHi: "lhec2", chaptersHi: 5, bytesHi: 11157526 },
  { id: "kefa1", klass: 11, subject: "art_culture", title: "An Introduction to Indian Art Part-I", code: "kefa1", chapters: 8, bytes: 199793173, codeHi: "khfa1", chaptersHi: 8, bytesHi: 56371238 },
  { id: "lefa1", klass: 12, subject: "art_culture", title: "An Introduction to Indian Art Part-II", code: "lefa1", chapters: 8, bytes: 43979708, codeHi: "lhfa1", chaptersHi: 8, bytesHi: 48161432 },
  { id: "kesy1", klass: 11, subject: "society", title: "Introducing Sociology", code: "kesy1", chapters: 5, bytes: 15830453, codeHi: "khsy1", chaptersHi: 5, bytesHi: 17518783 },
  { id: "lesy1", klass: 12, subject: "society", title: "Indian Society", code: "lesy1", chapters: 7, bytes: 19936165, codeHi: "lhsy1", chaptersHi: 7, bytesHi: 21390234 },
  { id: "lesy2", klass: 12, subject: "society", title: "Social Change and Development in India", code: "lesy2", chapters: 8, bytes: 21967931, codeHi: "lhsy2", chaptersHi: 8, bytesHi: 21818327 },
  { id: "fecu1", klass: 6, subject: "science_tech", title: "Curiosity", code: "fecu1", chapters: 12, bytes: 73711415, codeHi: "fhcu1", chaptersHi: 12, bytesHi: 76449671 },
  { id: "gecu1", klass: 7, subject: "science_tech", title: "Curiosity", code: "gecu1", chapters: 12, bytes: 43748851, codeHi: "ghcu1", chaptersHi: 12, bytesHi: 46055241 },
  { id: "hecu1", klass: 8, subject: "science_tech", title: "Curiosity", code: "hecu1", chapters: 13, bytes: 48172439, codeHi: "hhcu1", chaptersHi: 13, bytesHi: 39482545 },
  { id: "hesc1", klass: 8, subject: "science_tech", title: "Science", code: "hesc1", chapters: 13, bytes: 20362325 },
  { id: "iesc1", klass: 9, subject: "science_tech", title: "Exploration", code: "iesc1", chapters: 13, bytes: 124332937 },
  { id: "jesc1", klass: 10, subject: "science_tech", title: "Science", code: "jesc1", chapters: 13, bytes: 71057581, codeHi: "jhsc1", chaptersHi: 13, bytesHi: 45904927 },
  { id: "kebo1", klass: 11, subject: "science_tech", title: "Biology", code: "kebo1", chapters: 19, bytes: 57009592 },
  { id: "lebo1", klass: 12, subject: "science_tech", title: "Biology", code: "lebo1", chapters: 13, bytes: 160520741 },
];

export const OFFICIAL_RESOURCES: OfficialResource[] = [
  {
    id: "economic-survey",
    subject: "economy",
    title: "Economic Survey",
    publisher: "Ministry of Finance",
    url: "https://www.indiabudget.gov.in/economicsurvey/",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "union-budget",
    subject: "economy",
    title: "Union Budget",
    publisher: "Ministry of Finance",
    url: "https://www.indiabudget.gov.in/",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "rbi-annual-report",
    subject: "economy",
    title: "RBI Annual Report",
    publisher: "Reserve Bank of India",
    url: "https://www.rbi.org.in/Scripts/AnnualReportMainDisplay.aspx",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "niti-aayog",
    subject: "economy",
    title: "NITI Aayog reports and indices",
    publisher: "NITI Aayog",
    url: "https://www.niti.gov.in/",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "isfr",
    subject: "environment",
    title: "India State of Forest Report",
    publisher: "Forest Survey of India",
    url: "https://fsi.nic.in/forest-report-2023",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "digital-sansad",
    subject: "polity",
    title: "Digital Sansad — debates, bills and questions",
    publisher: "Parliament of India",
    url: "https://sansad.in/ls",
    exams: ["uppsc", "upsc"],
  },
  {
    id: "up-budget",
    subject: "state_focus",
    title: "Uttar Pradesh Budget",
    publisher: "Finance Department, Government of Uttar Pradesh",
    url: "https://budget.up.nic.in/",
    exams: ["uppsc"],
    stateSpecific: true,
  },
  {
    id: "up-state-portal",
    subject: "state_focus",
    title: "Uttar Pradesh State Portal",
    publisher: "Government of Uttar Pradesh",
    url: "https://up.gov.in/en",
    exams: ["uppsc"],
    stateSpecific: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SELECTORS
// ─────────────────────────────────────────────────────────────────────────────

/** The official free material relevant to this exam. */
export function officialResourcesFor(examCode: string): OfficialResource[] {
  return OFFICIAL_RESOURCES.filter((r) => (r.exams as string[]).includes(examCode));
}

/**
 * The subjects that actually have something to show for this exam — the filter
 * row is built from this, never from the full enum, so a chip can never select
 * an empty list.
 */
export function activeSubjects(examCode: string): ResourceSubject[] {
  const present = new Set<ResourceSubject>();
  for (const b of NCERT_BOOKS) present.add(b.subject);
  for (const r of officialResourcesFor(examCode)) present.add(r.subject);
  return RESOURCE_SUBJECTS.filter((s) => present.has(s));
}
