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
 * Stored as NCERT's own BOOK CODE plus a chapter count rather than as a list of
 * URLs, because the URL scheme is the verified thing: every file lives at
 * `/textbook/pdf/<code>…` as a plain static asset. Keeping the code means the
 * scheme is written down once ({@link ncertBookZipUrl} / {@link ncertChapterUrl})
 * instead of being re-typed 300 times.
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
}

/** NCERT's static asset root. Both `ncert.nic.in` and `www.` serve it identically. */
const NCERT_PDF_ROOT = "https://ncert.nic.in/textbook/pdf";

/** Whole book as a zip — `<code>dd.zip` is the only zip suffix NCERT serves. */
export function ncertBookZipUrl(code: string): string {
  return `${NCERT_PDF_ROOT}/${code}dd.zip`;
}

/**
 * A single chapter PDF. Offered alongside the zip because a zip is genuinely
 * awkward on the budget Android phones most of this audience reads on, where a
 * single PDF opens natively and a zip needs another app.
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
  { id: "fees1", klass: 6, subject: "social_science", title: "Exploring Society: India and Beyond", code: "fees1", chapters: 14, codeHi: "fhes1", chaptersHi: 14 },
  { id: "gees1", klass: 7, subject: "social_science", title: "Exploring Society: India and Beyond Part-I", code: "gees1", chapters: 12, codeHi: "ghes1", chaptersHi: 12 },
  { id: "gees2", klass: 7, subject: "social_science", title: "Exploring Society: India and Beyond Part-II", code: "gees2", chapters: 8, codeHi: "ghes2", chaptersHi: 8 },
  { id: "hees1", klass: 8, subject: "social_science", title: "Exploring Society: India and Beyond Part-I", code: "hees1", chapters: 7, codeHi: "hhes1", chaptersHi: 7 },
  { id: "hees2", klass: 8, subject: "social_science", title: "Exploring Society: India and Beyond Part-II", code: "hees2", chapters: 8 },
  { id: "iest1", klass: 9, subject: "social_science", title: "Understanding Society: India and Beyond Part-I", code: "iest1", chapters: 9 },
  { id: "hess2", klass: 8, subject: "history", title: "Our Pasts-III", code: "hess2", chapters: 8, codeHi: "hhss1", chaptersHi: 8 },
  { id: "jess3", klass: 10, subject: "history", title: "India and the Contemporary World-II", code: "jess3", chapters: 5, codeHi: "jhss3", chaptersHi: 5 },
  { id: "kehs1", klass: 11, subject: "history", title: "Themes in World History", code: "kehs1", chapters: 7, codeHi: "khhs1", chaptersHi: 7 },
  { id: "lehs1", klass: 12, subject: "history", title: "Themes in Indian History-I", code: "lehs1", chapters: 4, codeHi: "lhhs1", chaptersHi: 4 },
  { id: "lehs2", klass: 12, subject: "history", title: "Themes in Indian History-II", code: "lehs2", chapters: 4, codeHi: "lhhs2", chaptersHi: 4 },
  { id: "lehs3", klass: 12, subject: "history", title: "Themes in Indian History-III", code: "lehs3", chapters: 4, codeHi: "lhhs3", chaptersHi: 4 },
  { id: "hess3", klass: 8, subject: "polity", title: "Social and Political Life", code: "hess3", chapters: 8, codeHi: "hhss3", chaptersHi: 8 },
  { id: "jess4", klass: 10, subject: "polity", title: "Democratic Politics", code: "jess4", chapters: 5, codeHi: "jhss4", chaptersHi: 5 },
  { id: "keps1", klass: 11, subject: "polity", title: "Political Theory", code: "keps1", chapters: 8, codeHi: "khps1", chaptersHi: 8 },
  { id: "keps2", klass: 11, subject: "polity", title: "Indian Constitution at Work", code: "keps2", chapters: 10, codeHi: "khps2", chaptersHi: 10 },
  { id: "leps1", klass: 12, subject: "polity", title: "Contemporary World Politics", code: "leps1", chapters: 7, codeHi: "lhps1", chaptersHi: 7 },
  { id: "leps2", klass: 12, subject: "polity", title: "Politics in India Since Independence", code: "leps2", chapters: 8, codeHi: "lhps2", chaptersHi: 8 },
  { id: "hess4", klass: 8, subject: "geography", title: "Resource and Development", code: "hess4", chapters: 5, codeHi: "hhss4", chaptersHi: 5 },
  { id: "jess1", klass: 10, subject: "geography", title: "Contemporary India", code: "jess1", chapters: 7, codeHi: "jhss1", chaptersHi: 7 },
  { id: "kegy1", klass: 11, subject: "geography", title: "India Physical Environment", code: "kegy1", chapters: 6, codeHi: "khgy1", chaptersHi: 6 },
  { id: "kegy2", klass: 11, subject: "geography", title: "Fundamentals of Physical Geography", code: "kegy2", chapters: 14, codeHi: "khgy2", chaptersHi: 14 },
  { id: "kegy3", klass: 11, subject: "geography", title: "Practical Work in Geography", code: "kegy3", chapters: 6, codeHi: "khgy3", chaptersHi: 6 },
  { id: "legy1", klass: 12, subject: "geography", title: "Fundamentals of Human Geography", code: "legy1", chapters: 8, codeHi: "lhgy1", chaptersHi: 8 },
  { id: "legy2", klass: 12, subject: "geography", title: "India People and Economy", code: "legy2", chapters: 9, codeHi: "lhgy2", chaptersHi: 9 },
  { id: "legy3", klass: 12, subject: "geography", title: "Practical Work in Geography Part-II", code: "legy3", chapters: 4 },
  { id: "jess2", klass: 10, subject: "economy", title: "Understanding Economic Development", code: "jess2", chapters: 5, codeHi: "jhss2", chaptersHi: 5 },
  { id: "keec1", klass: 11, subject: "economy", title: "Indian Economic Development", code: "keec1", chapters: 8, codeHi: "khec1", chaptersHi: 8 },
  { id: "kest1", klass: 11, subject: "economy", title: "Statistics for Economics", code: "kest1", chapters: 8, codeHi: "khst1", chaptersHi: 8 },
  { id: "leec1", klass: 12, subject: "economy", title: "Introductory Macroeconomics", code: "leec1", chapters: 6, codeHi: "lhec1", chaptersHi: 6 },
  { id: "leec2", klass: 12, subject: "economy", title: "Introductory Microeconomics", code: "leec2", chapters: 5, codeHi: "lhec2", chaptersHi: 5 },
  { id: "kefa1", klass: 11, subject: "art_culture", title: "An Introduction to Indian Art Part-I", code: "kefa1", chapters: 8, codeHi: "khfa1", chaptersHi: 8 },
  { id: "lefa1", klass: 12, subject: "art_culture", title: "An Introduction to Indian Art Part-II", code: "lefa1", chapters: 8, codeHi: "lhfa1", chaptersHi: 8 },
  { id: "kesy1", klass: 11, subject: "society", title: "Introducing Sociology", code: "kesy1", chapters: 5, codeHi: "khsy1", chaptersHi: 5 },
  { id: "lesy1", klass: 12, subject: "society", title: "Indian Society", code: "lesy1", chapters: 7, codeHi: "lhsy1", chaptersHi: 7 },
  { id: "lesy2", klass: 12, subject: "society", title: "Social Change and Development in India", code: "lesy2", chapters: 8, codeHi: "lhsy2", chaptersHi: 8 },
  { id: "fecu1", klass: 6, subject: "science_tech", title: "Curiosity", code: "fecu1", chapters: 12, codeHi: "fhcu1", chaptersHi: 12 },
  { id: "gecu1", klass: 7, subject: "science_tech", title: "Curiosity", code: "gecu1", chapters: 12, codeHi: "ghcu1", chaptersHi: 12 },
  { id: "hecu1", klass: 8, subject: "science_tech", title: "Curiosity", code: "hecu1", chapters: 13, codeHi: "hhcu1", chaptersHi: 13 },
  { id: "hesc1", klass: 8, subject: "science_tech", title: "Science", code: "hesc1", chapters: 13 },
  { id: "iesc1", klass: 9, subject: "science_tech", title: "Exploration", code: "iesc1", chapters: 13 },
  { id: "jesc1", klass: 10, subject: "science_tech", title: "Science", code: "jesc1", chapters: 13, codeHi: "jhsc1", chaptersHi: 13 },
  { id: "kebo1", klass: 11, subject: "science_tech", title: "Biology", code: "kebo1", chapters: 19 },
  { id: "lebo1", klass: 12, subject: "science_tech", title: "Biology", code: "lebo1", chapters: 13 },
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
