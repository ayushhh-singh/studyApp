/**
 * Reference books named by the two booklist articles.
 *
 * ⚑ THE LEGAL LINE, AND IT IS THE WHOLE DESIGN OF THIS FILE: review the book,
 * never host or link the book. `docs/content-strategy.md` §7, confirmed as
 * industry-standard rather than overcaution — SuperKalam publishes a full
 * Laxmikanth review and links no PDF (§1a).
 *
 * Every title below is in copyright. Every "free UPSC book PDF" site an aspirant
 * finds is distributing pirated copies of exactly these. So, exactly as
 * `lib/resources.ts` does for NCERT:
 *
 *   - NO TYPE HERE HAS A DOWNLOAD FIELD, and none may be added. The only URL a
 *     book carries is `publisherUrl`.
 *   - `publisherUrl` MUST be on the publisher's own domain. Never a retailer
 *     (amazon.in 500s on automated fetch, so a retailer link cannot even be
 *     verified), never an aggregator, never a file.
 *   - A title with no verifiable publisher product page is NOT LISTED. It is
 *     better to name fewer books than to send a reader somewhere we cannot
 *     stand behind.
 *
 * VERIFIED 2026-08-14, BY CONTENT RATHER THAN BY STATUS CODE — the same
 * standard `lib/resources.ts` holds its 752 links to, and for the same reason: a
 * publisher CMS answers a dead product path with 200 and a category page, so a
 * status check passes while the link is wrong. Each URL was fetched and the
 * book's own ISBN asserted present in the returned HTML. All 8 passed.
 *
 * To re-verify, fetch each `publisherUrl` and assert its `isbn` (ignoring
 * hyphens and whitespace) appears in the body. Re-run when prices or editions
 * are next reviewed — publisher pages move, and the Orient BlackSwan entry is
 * the most fragile (a bare `?obsin=` query param with no slug).
 *
 * ⚑ TWO FINDINGS THAT WOULD OTHERWISE COST A READER A WRONG BOOK:
 *
 *  1. McGraw Hill renamed its whole UPSC line to "Courseware on …" in 2025.
 *     Laxmikanth's 7th edition is on their site as plain "Indian Polity"; the
 *     CURRENT 8th edition is "Courseware on Indian Polity", and their own copy
 *     says so ("the 8th Edition of its flagship title, Indian Polity … now
 *     designed as a Courseware"). Searching for the title every coaching list
 *     prints lands on the superseded edition. The current names are used here.
 *  2. Drishti's "उत्तर प्रदेश एक परिचय" DOES NOT EXIST. Their own shop was
 *     searched in English and Devanagari; the UPPCS collection is 11 titles,
 *     all solved-papers or mains capsules, with no general UP GK book at all.
 *     It is widely cited in booklists anyway. The UP slot uses Arihant instead.
 *
 * PRICES ARE MRP AS THE PUBLISHER'S PAGE SHOWS IT, never a live discounted
 * figure (Arihant showed ₹280 against an MRP of ₹350 on the day of checking;
 * discounts move, MRP does not). They are stated as "at the time of checking"
 * in the article, not as current.
 */

/** Which of the two booklists a title belongs on. Several serve both. */
export type BooklistExam = "uppsc" | "upsc";

export interface ReferenceBook {
  /** The publisher's CURRENT product name, not the name coaching lists print. */
  title: string;
  author: string | null;
  publisher: string;
  isbn: string;
  /** MRP in rupees, as shown on the publisher's page. Null if the page showed none. */
  priceInr: number | null;
  /** The publisher's own product page. Never a retailer, never a file. */
  publisherUrl: string;
  exams: readonly BooklistExam[];
  /** i18n key under `Booklist.subject.` — what this book is for. */
  subjectKey: string;
  /** i18n key under `Booklist.note.` — why it earns its place, in one line. */
  noteKey: string;
}

export const REFERENCE_BOOKS: ReferenceBook[] = [
  {
    title: "Courseware on Indian Polity",
    author: "M. Laxmikanth",
    publisher: "McGraw Hill India",
    isbn: "9789364447676",
    priceInr: 1195,
    publisherUrl: "https://www.mheducation.co.in/courseware-on-indian-polity-9789364447676-india",
    exams: ["uppsc", "upsc"],
    subjectKey: "polity",
    noteKey: "polity",
  },
  {
    title: "Courseware on Indian Economy",
    author: "Ramesh Singh",
    publisher: "McGraw Hill India",
    isbn: "9789364446570",
    priceInr: 825,
    publisherUrl: "https://www.mheducation.co.in/courseware-on-indian-economy-9789364446570-india",
    exams: ["uppsc", "upsc"],
    subjectKey: "economy",
    noteKey: "economy",
  },
  {
    title: "India's Ancient Past",
    author: "R.S. Sharma",
    publisher: "Oxford University Press India",
    isbn: "9789354977527",
    priceInr: 445,
    publisherUrl: "https://india.oup.com/product/indias-ancient-past-9789354977527/",
    exams: ["uppsc", "upsc"],
    subjectKey: "history",
    noteKey: "ancient",
  },
  {
    title: "History of Medieval India",
    author: "Satish Chandra",
    publisher: "Orient BlackSwan",
    isbn: "9789390122547",
    priceInr: 595,
    publisherUrl: "https://www.orientblackswan.com/details?obsin=1488",
    exams: ["uppsc", "upsc"],
    subjectKey: "history",
    noteKey: "medieval",
  },
  {
    title: "India's Struggle for Independence",
    author: "Bipan Chandra",
    publisher: "Penguin Random House India",
    isbn: "9780140107814",
    priceInr: 399,
    publisherUrl: "https://www.penguin.co.in/book/indias-struggle-for-independence/",
    exams: ["uppsc", "upsc"],
    subjectKey: "history",
    noteKey: "modern",
  },
  {
    title: "Certificate Physical and Human Geography",
    author: "Goh Cheng Leong",
    publisher: "Oxford University Press India",
    isbn: "9789354975660",
    priceInr: 360,
    publisherUrl: "https://india.oup.com/product/certificate-physical-and-human-geography-9789354975660/",
    exams: ["uppsc", "upsc"],
    subjectKey: "geography",
    noteKey: "leong",
  },
  {
    title: "Oxford Student Atlas for India",
    author: null,
    publisher: "Oxford University Press India",
    isbn: "9789367250501",
    priceInr: 425,
    publisherUrl: "https://india.oup.com/product/oxford-student-atlas-for-india-9789367250501/",
    exams: ["uppsc", "upsc"],
    subjectKey: "geography",
    noteKey: "atlas",
  },
  {
    title: "Know Your State Uttar Pradesh",
    author: "Rajesh Pandey and Uttam Singh",
    publisher: "Arihant Publications",
    isbn: "9789378162039",
    priceInr: 350,
    publisherUrl:
      "https://arihantbooks.com/products/know-your-state-uttar-pradesh-general-knowledge-highly-useful-for-uppcs-upsssc-other-competitive-exams-with-important-map-flow-charts-tables-practice-mcqs-pyqs-budget-2026-27",
    exams: ["uppsc"],
    subjectKey: "upSpecific",
    noteKey: "upState",
  },
];

/** Books on one exam's list, in the order declared above. */
export function booksForExam(exam: BooklistExam): ReferenceBook[] {
  return REFERENCE_BOOKS.filter((b) => b.exams.includes(exam));
}

/**
 * Titles DELIBERATELY NOT LISTED, and why — kept in code so the exclusions are
 * a decision anyone can audit rather than an omission somebody "fixes" later by
 * adding a retailer link.
 *
 * Every one of these appears on mainstream booklists. None of them had a
 * verifiable publisher product page when checked on 2026-08-14. They are named
 * in the articles as "commonly recommended, no publisher page we could verify",
 * which is more useful to a reader than silence and more honest than a link we
 * cannot stand behind.
 */
export const UNVERIFIED_TITLES: readonly string[] = [
  "Pavneet Singh — International Relations",
  "The Lexicon for Ethics, Integrity and Aptitude",
  "D.D. Basu — Introduction to the Constitution of India",
  "C.L. Khanna — CSAT / aptitude titles",
  "Disha — Amazing Uttar Pradesh",
  "Sahitya Bhawan — Uttar Pradesh Ek Adhyayan",
  'Drishti — "उत्तर प्रदेश एक परिचय" (searched twice; no such title exists)',
];

/**
 * Out of print, still in copyright, and NCERT keeps no archive — so these may be
 * named and reviewed and must NEVER be linked (§7). Listed here so the rule
 * travels with the data rather than living only in a doc.
 */
export const NAMEABLE_BUT_NEVER_LINKABLE: readonly string[] = [
  "R.S. Sharma — Ancient India (old NCERT)",
  "Satish Chandra — Medieval India (old NCERT)",
  "Bipan Chandra — Modern India (old NCERT)",
  "Arjun Dev — The Story of Civilization (old NCERT)",
];
