/**
 * Shared helpers for the content-ingestion CLIs in this directory.
 *
 * Every ingest:* script reads real files from /content-raw (per manifest.json)
 * and writes real rows to the linked Supabase project. There is NO mock data.
 */
import { readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFParse } from "pdf-parse";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_EXAM_CODE,
  TARGET_EXAM_CODES,
  examCodeSchema,
  type ExamCode as SharedExamCode,
  type TargetExamCode,
} from "@neev/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/ingest -> repo root is four levels up.
export const ROOT = join(__dirname, "..", "..", "..", "..");
export const CONTENT_RAW = join(ROOT, "content-raw");
export const MANIFEST_PATH = join(CONTENT_RAW, "manifest.json");
export const PARSED_DIR = join(CONTENT_RAW, "parsed");

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
export interface ManifestEntry {
  id: string;
  section: "syllabus" | "pyq_prelims" | "pyq_mains" | "answer_key";
  url: string;
  /** Source tier stamped by content:fetch (A official / B compilation). */
  tier?: "A" | "B";
  /** Exam attribution stamped by content:fetch. */
  exam?: string;
  path: string; // repo-relative, e.g. content-raw/syllabus/xxx.pdf
  sha256: string;
  bytes: number;
  pages: number;
  fetched_at: string;
  status: string;
  origin: string;
}

export async function readManifest(): Promise<ManifestEntry[]> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as ManifestEntry[];
}

export function manifestBySection(
  entries: ManifestEntry[],
  section: ManifestEntry["section"],
): ManifestEntry[] {
  return entries
    .filter((e) => e.section === section && e.status === "ok")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function absPath(entry: ManifestEntry): string {
  return join(ROOT, entry.path);
}

// ---------------------------------------------------------------------------
// PDF extraction (+ scanned/image-only detection)
// ---------------------------------------------------------------------------
export interface ExtractedPdf {
  /** Full concatenated text. Empty/near-empty ⇒ likely a scanned/image PDF. */
  text: string;
  pageCount: number;
  /** chars of extracted text per page — the signal for "scanned". */
  charsPerPage: number;
  /** true when text extraction yielded too little to trust (route to vision). */
  likelyScanned: boolean;
}

/** Below this many extracted characters per page, treat the PDF as scanned. */
const SCANNED_CHARS_PER_PAGE = 80;

export async function extractPdf(fileAbsPath: string): Promise<ExtractedPdf> {
  const buf = await readFile(fileAbsPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const info = await parser.getInfo();
    const pageCount = info.total ?? 0;
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    const charsPerPage = pageCount > 0 ? text.length / pageCount : text.length;
    return {
      text,
      pageCount,
      charsPerPage,
      likelyScanned: charsPerPage < SCANNED_CHARS_PER_PAGE,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Read a PDF as a base64 string (no newlines) for a Claude `document` block. */
export async function pdfBase64(fileAbsPath: string): Promise<string> {
  const buf = await readFile(fileAbsPath);
  return buf.toString("base64");
}

/** A Claude user-content document block wrapping a whole PDF (for vision). */
export async function pdfDocumentBlock(fileAbsPath: string) {
  return {
    type: "document" as const,
    source: {
      type: "base64" as const,
      media_type: "application/pdf" as const,
      data: await pdfBase64(fileAbsPath),
    },
  };
}

/**
 * A document block containing only the given (0-based) pages of a PDF. Used to
 * chunk a large scanned paper under the Anthropic request-size limit — a 30MB+
 * scan can't be attached whole, so extraction sends it a few pages at a time.
 */
export async function pdfSubsetDocumentBlock(fileAbsPath: string, pageIndices: number[]) {
  const src = await PDFDocument.load(await readFile(fileAbsPath));
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageIndices);
  copied.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return {
    type: "document" as const,
    source: {
      type: "base64" as const,
      media_type: "application/pdf" as const,
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}

// ---------------------------------------------------------------------------
// Bilingual helpers ({hi,en}) + publish gate
// ---------------------------------------------------------------------------
export interface I18n {
  hi: string;
  en: string;
}

export function i18nComplete(v: Partial<I18n> | null | undefined): v is I18n {
  return !!v && !!v.hi?.trim() && !!v.en?.trim();
}

/**
 * Mirror of the DB `public.question_publishable` gate (migration 0017), so the
 * ingest side agrees with the trigger and never sets is_published on a row the
 * DB would reject (which would abort the load). ALL questions need a bilingual
 * stem; MCQ additionally needs >=2 options, every option with a non-blank key +
 * bilingual text, and a correct_option_key that matches one of the keys.
 */
export function questionPublishable(
  type: "mcq" | "descriptive",
  stem: Partial<I18n> | null | undefined,
  options: { key: string; text_i18n: Partial<I18n> }[] | null | undefined,
  correct: string | null | undefined,
): boolean {
  if (!i18nComplete(stem)) return false;
  if (type !== "mcq") return true;
  if (!options || options.length < 2) return false;
  const keys = options.map((o) => (o.key ?? "").trim());
  if (keys.some((k) => !k)) return false;
  if (options.some((o) => !i18nComplete(o.text_i18n))) return false;
  if (!correct || !keys.includes(correct.trim())) return false;
  return true;
}

/**
 * Detect mojibake Hindi: a field that should be Devanagari but came through as
 * garbled Latin (the legacy non-Unicode font in many UPPSC PDFs). True when the
 * Hindi field has Latin letters, zero Devanagari codepoints, and differs from
 * the English field (so language-neutral values like "4, 2, 3, 1" are kept).
 */
export function isMojibakeHindi(hi: string, en: string): boolean {
  const h = (hi ?? "").trim();
  if (!h || h === (en ?? "").trim()) return false;
  const devanagari = (h.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (h.match(/[A-Za-z]/g) ?? []).length;
  return devanagari === 0 && latin > 0;
}

// ---------------------------------------------------------------------------
// Paper definitions — globally-unique paper_code per paper so the
// (paper_code, path) upsert key never collides across exam stages OR EXAMS.
//
// `exam` (added closing M1) is what `ingest:syllabus` stamps onto
// `syllabus_nodes.exam_code`. It is a PRODUCT exam (what a user can target),
// not the provenance `ExamCode` on `questions.exam_code` — the two enums are
// deliberately different (see packages/shared/src/exams.ts).
//
// !! THE LOAD-BEARING INVARIANT (docs/multi-exam.md §0): `paper_code` is unique
// !! ACROSS exams, not just within one. ~30 call sites filter by `paper_code`
// !! alone and are correct only because of it, and the upsert conflict target
// !! here is (paper_code, path) — so a second exam reusing a bare `PRE_GS1`
// !! would OVERWRITE the UPPSC tree in place rather than insert its own.
// !! A non-default exam's paper codes MUST therefore be exam-prefixed
// !! (`UPSC_PRE_GS1`). `assertPaperCodeScoped` below enforces that at ingest
// !! time so the rule cannot be broken by convention alone.
// ---------------------------------------------------------------------------
export type ExamStage = "prelims" | "mains";

export interface PaperDef {
  /** Product exam this paper belongs to — written to `syllabus_nodes.exam_code`. */
  exam: TargetExamCode;
  paperCode: string;
  stage: ExamStage;
  title: I18n;
}

/**
 * The paper-code prefix a given exam's papers must carry. The default exam
 * (uppsc) keeps its historical bare codes — every existing row, test slug,
 * `like 'PRE_%'` scan and board key depends on them — so only a SECOND exam
 * pays the prefix cost.
 */
export function paperCodePrefixFor(exam: TargetExamCode): string {
  return exam === DEFAULT_EXAM_CODE ? "" : `${exam.toUpperCase()}_`;
}

/**
 * Throw unless `paperCode` is correctly scoped for `exam`. Called before the
 * first write of any paper's tree: a violation here is a loud failure at ingest
 * instead of a silent in-place overwrite of another exam's syllabus.
 */
export function assertPaperCodeScoped(exam: TargetExamCode, paperCode: string): void {
  const prefix = paperCodePrefixFor(exam);
  if (prefix && !paperCode.startsWith(prefix)) {
    throw new Error(
      `paper_code "${paperCode}" is not scoped to exam "${exam}" — it must start with "${prefix}". ` +
        `syllabus_nodes.paper_code is globally unique across exams (see docs/multi-exam.md §0); ` +
        `a bare code would overwrite another exam's tree through the (paper_code, path) upsert key.`,
    );
  }
  // The converse: a default-exam paper must not wear another exam's prefix.
  if (!prefix) {
    for (const other of TARGET_EXAM_CODES) {
      const p = paperCodePrefixFor(other);
      if (p && paperCode.startsWith(p)) {
        throw new Error(`paper_code "${paperCode}" is prefixed for "${other}" but is being ingested as "${exam}".`);
      }
    }
  }
}

export const PAPERS: PaperDef[] = [
  // Prelims
  {
    exam: "uppsc",
    paperCode: "PRE_GS1",
    stage: "prelims",
    title: { hi: "प्रारंभिक — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Prelims — General Studies Paper I" },
  },
  {
    exam: "uppsc",
    paperCode: "PRE_CSAT",
    stage: "prelims",
    title: { hi: "प्रारंभिक — सी-सैट (सामान्य अध्ययन द्वितीय प्रश्नपत्र)", en: "Prelims — CSAT (General Studies Paper II)" },
  },
  // Reformed Mains (8 papers)
  {
    exam: "uppsc",
    paperCode: "MAINS_GH",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य हिन्दी", en: "Mains — General Hindi" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_ESSAY",
    stage: "mains",
    title: { hi: "मुख्य — निबंध", en: "Mains — Essay" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS1",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Mains — General Studies Paper I" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS2",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन द्वितीय प्रश्नपत्र", en: "Mains — General Studies Paper II" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS3",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन तृतीय प्रश्नपत्र", en: "Mains — General Studies Paper III" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS4",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन चतुर्थ प्रश्नपत्र", en: "Mains — General Studies Paper IV" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS5",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन पंचम प्रश्नपत्र (उत्तर प्रदेश विशेष)", en: "Mains — General Studies Paper V (UP-specific)" },
  },
  {
    exam: "uppsc",
    paperCode: "MAINS_GS6",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन षष्ठम प्रश्नपत्र (उत्तर प्रदेश विशेष)", en: "Mains — General Studies Paper VI (UP-specific)" },
  },

  // -------------------------------------------------------------------------
  // UPSC Civil Services — the 7 GENERAL-STUDIES papers in product scope.
  // Codes are `UPSC_`-prefixed, which is MANDATORY, not stylistic: see the
  // load-bearing-invariant block above and docs/multi-exam.md §0 —
  // `assertPaperCodeScoped` throws on a bare code so the rule cannot be broken
  // by convention alone. Official labels below are from migration 0106's
  // verified `exams.upsc.paper_structure` (sourced from the UPSC CSE official
  // notification), NOT from memory.
  //
  // Its tree is HAND-AUTHORED and loaded by `pnpm ingest:upsc-syllabus`
  // (apps/api/src/ingest/seed/), never by `ingest:syllabus` — that script
  // hardcodes the UPPSC manifest ids, LLM-invents the tree (which cannot pass a
  // verbatim coverage gate), and its prompts call `requireAuthored(...)`, which
  // THROWS for `upsc` by design (docs/OUTSTANDING.md §8f "U6").
  //
  // DELIBERATELY EXCLUDED — no paper code, no tree, by design:
  //   - Mains Paper-A (Indian Language, Eighth Schedule) and Paper-B (English)
  //     are QUALIFYING LANGUAGE papers (25% evaluation_gate, marks never count
  //     for merit). Not General Studies.
  //   - Mains Paper-VI and Paper-VII are the candidate-CHOSEN optional subject
  //     (~25 subjects plus 23 language literatures, × 2 papers, and both papers
  //     must be the SAME subject). Not General Studies, and not one syllabus.
  //   Neither is in product scope, so neither gets a paper code. Adding one
  //   later means adding a PaperDef here plus its own authored tree.
  {
    exam: "upsc",
    paperCode: "UPSC_PRE_GS1", // official label: Prelims Paper I
    stage: "prelims",
    title: { hi: "प्रारंभिक — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Prelims — General Studies Paper I" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_PRE_CSAT", // official label: Prelims Paper II
    stage: "prelims",
    title: { hi: "प्रारंभिक — सी-सैट (सामान्य अध्ययन द्वितीय प्रश्नपत्र)", en: "Prelims — CSAT (General Studies Paper II)" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_MAINS_ESSAY", // official label: Paper-I
    stage: "mains",
    title: { hi: "मुख्य — निबंध", en: "Mains — Essay" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_MAINS_GS1", // official label: Paper-II
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Mains — General Studies I" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_MAINS_GS2", // official label: Paper-III
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन द्वितीय प्रश्नपत्र", en: "Mains — General Studies II" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_MAINS_GS3", // official label: Paper-IV
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन तृतीय प्रश्नपत्र", en: "Mains — General Studies III" },
  },
  {
    exam: "upsc",
    paperCode: "UPSC_MAINS_GS4", // official label: Paper-V (Ethics)
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन चतुर्थ प्रश्नपत्र", en: "Mains — General Studies IV" },
  },
];

export function paperByCode(code: string): PaperDef | undefined {
  return PAPERS.find((p) => p.paperCode === code);
}

// ---------------------------------------------------------------------------
// Multi-exam attribution + source provenance (matches the questions columns
// added in migration 0036).
// ---------------------------------------------------------------------------
/**
 * RE-EXPORTED, not redeclared. This was a local duplicate of the shared enum and
 * it had already drifted: when `examCodeSchema` gained 'mppsc' (migration 0106
 * extended the matching `questions.exam_code` CHECK), this copy did not, so the
 * ingest pipeline silently could not classify or label an MPPSC paper — with no
 * typecheck error, because it was a separate declaration. Deriving it from the
 * single source of truth makes that drift impossible.
 */
export type ExamCode = SharedExamCode;
export type SourceKind = "official" | "compilation" | "generated" | "manual";

/** Every exam code except the 'other' catch-all, which is never a filename prefix. */
const EXAM_PREFIXES: ExamCode[] = examCodeSchema.options.filter(
  (c): c is Exclude<ExamCode, "other"> => c !== "other",
);

/** Bilingual attribution label per exam × stage — rendered as the chip's exam half. */
const EXAM_LABELS: Record<ExamCode, { prelims: I18n; mains: I18n }> = {
  uppsc: {
    prelims: { en: "UPPSC Prelims", hi: "यूपीपीएससी प्रारंभिक" },
    mains: { en: "UPPSC Mains", hi: "यूपीपीएससी मुख्य" },
  },
  upsc: {
    prelims: { en: "UPSC Prelims", hi: "यूपीएससी प्रारंभिक" },
    mains: { en: "UPSC Mains", hi: "यूपीएससी मुख्य" },
  },
  up_ro_aro: {
    prelims: { en: "UP RO/ARO", hi: "यूपी आरओ/एआरओ" },
    mains: { en: "UP RO/ARO", hi: "यूपी आरओ/एआरओ" },
  },
  upsssc_pet: {
    prelims: { en: "UPSSSC PET", hi: "यूपीएसएसएससी पीईटी" },
    mains: { en: "UPSSSC PET", hi: "यूपीएसएसएससी पीईटी" },
  },
  mppsc: {
    prelims: { en: "MPPSC Prelims", hi: "एमपीपीएससी प्रारंभिक" },
    mains: { en: "MPPSC Mains", hi: "एमपीपीएससी मुख्य" },
  },
  other: {
    prelims: { en: "Other exam", hi: "अन्य परीक्षा" },
    mains: { en: "Other exam", hi: "अन्य परीक्षा" },
  },
};

export function examLabel(exam: ExamCode, stage: ExamStage): I18n {
  return EXAM_LABELS[exam][stage];
}

/** Derive the exam code from a manifest id prefix, defaulting to uppsc. */
export function examCodeFromId(id: string): ExamCode {
  for (const e of EXAM_PREFIXES) if (id.startsWith(`${e}_`)) return e;
  return "uppsc";
}

const GOV_HOST_SUFFIXES = ["gov.in", "nic.in", "upload.wikimedia.org"];

/** True when the URL's HOST (not any substring) is an official/gov/public-archive domain. */
function isOfficialHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return GOV_HOST_SUFFIXES.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Provenance tier for a fetched source — prefer the stamped tier, else infer from the URL host. */
export function sourceKindForEntry(entry: ManifestEntry): SourceKind {
  const tier = entry.tier ?? (isOfficialHost(entry.url) ? "A" : "B");
  return tier === "A" ? "official" : "compilation";
}

/** True when the source is a Tier-B third-party compilation (stricter extraction rules apply). */
export function isCompilationEntry(entry: ManifestEntry): boolean {
  return sourceKindForEntry(entry) === "compilation";
}

/**
 * PROVENANCE exam → the PRODUCT exam whose syllabus tree, paper codes and prompt
 * framing a paper is ingested INTO. Closes docs/OUTSTANDING.md **M23**.
 *
 * The two enums are deliberately different (packages/shared/src/exams.ts):
 * `ExamCode` answers "which exam ASKED this question" and includes exams we
 * ingest PYQs from but never sell; `TargetExamCode` answers "which exam can a
 * user pick". M23 existed precisely because no mapping between them was defined,
 * so `classifyPyqId` could not know whether to prefix a paper code.
 *
 * The mapping, and why each half is what it is:
 *
 *  - A provenance exam that IS ALSO a product exam (uppsc, upsc, mppsc) ingests
 *    into ITSELF — its own tree, its own exam-prefixed paper codes.
 *  - A provenance-only exam (up_ro_aro, upsssc_pet, other) has no tree and no
 *    product of its own, so it keeps mapping onto the DEFAULT exam's shared
 *    prelims syllabus for weightage overlap. That is the pre-existing, deliberate
 *    behaviour documented on `classifyPyqId` — not a fallback bolted on here.
 *
 * Consequence worth stating explicitly: for every id that existed before M23 was
 * fixed this returns the default exam, whose prefix is `""`, so **every existing
 * manifest id classifies byte-identically to before.** Only a genuinely new
 * product exam's papers change shape.
 */
export function productExamForProvenance(examCode: ExamCode): TargetExamCode {
  const asProduct = TARGET_EXAM_CODES.find((t) => t === (examCode as string));
  return asProduct ?? DEFAULT_EXAM_CODE;
}

/**
 * Map a PYQ manifest id to {examCode, productExam, paperCode, year, stage}.
 * Handles all exams (uppsc/upsc/mppsc/up_ro_aro/upsssc_pet) — e.g.
 * uppsc_mains_2025_gs5, upsc_prelims_2024_gs1. Non-product objective exams
 * (RO/ARO, PET) map their GS papers onto the shared DEFAULT-exam prelims syllabus
 * (PRE_GS1) for weightage overlap; questions beyond that scope are kept
 * out_of_syllabus at load. Returns null for anything we can't confidently place.
 *
 * !! M23: the returned `paperCode` is EXAM-PREFIXED for a non-default product
 * !! exam (`UPSC_PRE_GS1`), because `syllabus_nodes.paper_code` is globally
 * !! unique across exams (docs/multi-exam.md §0) and ~30 call sites — including
 * !! `pyq-load.ts`'s `resolveSyllabusId`, which WRITES `questions.
 * !! syllabus_node_id` — filter on paper_code alone. Returning a bare `PRE_GS1`
 * !! here is what would have silently attached a second exam's PYQs to UPPSC's
 * !! tree, with no constraint violation to notice.
 */
export function classifyPyqId(
  id: string,
): {
  examCode: ExamCode;
  productExam: TargetExamCode;
  paperCode: string;
  year: number;
  stage: ExamStage;
} | null {
  // Built from EXAM_PREFIXES rather than hardcoded, so adding an exam to the
  // shared enum cannot leave this pattern silently behind.
  const m = id.match(
    new RegExp(`^(${EXAM_PREFIXES.join("|")})_(prelims|mains)_(\\d{4})_([a-z0-9_]+?)(_mirror)?$`),
  );
  if (!m) return null;
  const [, examRaw, stageRaw, yearRaw, paperRaw] = m;
  const examCode = examRaw as ExamCode;
  const stage = stageRaw as ExamStage;
  const year = Number(yearRaw);
  const map: Record<string, string> = {
    gs1: stage === "prelims" ? "PRE_GS1" : "MAINS_GS1",
    gs: "PRE_GS1",
    general_studies: "PRE_GS1",
    csat: "PRE_CSAT",
    gs2: "MAINS_GS2",
    gs3: "MAINS_GS3",
    gs4: "MAINS_GS4",
    gs5: "MAINS_GS5",
    gs6: "MAINS_GS6",
    essay: "MAINS_ESSAY",
    general_hindi: "MAINS_GH",
  };
  const baseCode = map[paperRaw];
  if (!baseCode) return null;
  const productExam = productExamForProvenance(examCode);
  const paperCode = `${paperCodePrefixFor(productExam)}${baseCode}`;
  // A non-default product exam only has the papers ITS OWN tree defines. UPSC has
  // no GS5/GS6/General-Hindi paper, so `upsc_mains_2020_gs5` must fail loudly at
  // classification rather than mint a paper code with no syllabus behind it (which
  // would load questions that map to nothing and are invisible to every read).
  if (productExam !== DEFAULT_EXAM_CODE && !PAPERS.some((p) => p.exam === productExam && p.paperCode === paperCode)) {
    return null;
  }
  // Belt-and-braces: the prefix is constructed from `paperCodePrefixFor` just
  // above, so this cannot fire today — it is here so a future change to that
  // function fails loudly instead of silently un-scoping a paper code again.
  assertPaperCodeScoped(productExam, paperCode);
  // Pre-reform UPPSC Mains (2018-2022) used a 4-GS-paper structure. This is a
  // parse-time placeholder (MAINS_GS1-4); those questions are then CONTENT-mapped
  // to the reformed GS1-6 nodes and their paper_code re-assigned to the mapped
  // node's paper (with the original preserved in meta.historical_paper). We do
  // NOT use separate MAINS_*_PRE paper codes — they'd duplicate the paper list.
  return { examCode, productExam, paperCode, year, stage };
}

// ---------------------------------------------------------------------------
// parsed/ review-artifact directory
// ---------------------------------------------------------------------------
export async function ensureParsedDir(): Promise<void> {
  if (!existsSync(PARSED_DIR)) await mkdir(PARSED_DIR, { recursive: true });
}

export async function listParsed(prefix = ""): Promise<string[]> {
  if (!existsSync(PARSED_DIR)) return [];
  const files = await readdir(PARSED_DIR);
  return files
    .filter((f) => f.endsWith(".json") && f.startsWith(prefix))
    .sort()
    .map((f) => join(PARSED_DIR, f));
}

// ---------------------------------------------------------------------------
// Tiny CLI reporter — clear, uncoloured, greppable output.
// ---------------------------------------------------------------------------
export const report = {
  section(title: string): void {
    console.log(`\n${"─".repeat(64)}\n${title}\n${"─".repeat(64)}`);
  },
  step(msg: string): void {
    console.log(`  ${msg}`);
  },
  ok(msg: string): void {
    console.log(`  ✓ ${msg}`);
  },
  warn(msg: string): void {
    console.log(`  ⚠ ${msg}`);
  },
  fail(msg: string): void {
    console.log(`  ✗ ${msg}`);
  },
};

// ---------------------------------------------------------------------------
// CLI argument parsing — SCHEMA-DRIVEN AND FAIL-CLOSED.
//
// ⚑ THIS IS A SAFETY GUARD, NOT A CONVENIENCE. It exists because the previous
// permissive version caused a real production incident (docs/OUTSTANDING.md
// §0d, 2026-07-31): `ingest:syllabus` ran for real against the DB — which is the
// SAME Supabase project for dev AND prod — twice, writing +85 orphan rows and
// overwriting 35 in place, recovered only from the weekly encrypted pg_dump.
//
// The old parser had THREE silent-misparse shapes, and every one of them makes a
// SCOPED run silently WIDEN or REDIRECT rather than fail:
//
//   (a) A BARE POSITIONAL was invisible. The loop did `if (!a.startsWith("--"))
//       continue`, so `ingest:syllabus upsc` — an operator simply forgetting
//       `--exam` — produced NO key at all and ran against the DEFAULT exam.
//   (b) A COLLAPSED MULTI-WORD TOKEN became a NONSENSE KEY. This is the actual
//       incident: zsh does NOT word-split an unquoted "$var", so
//       `--exam upsc --dry-run` arrived as ONE argv token. That parsed to the key
//       `"exam upsc --dry-run"`, leaving `args.exam` *undefined* (NOT `true`, so
//       a valueless-flag check structurally could not see it) and swallowing
//       `--dry-run` so `dryRun` was FALSE.
//   (c) A VALUELESS VALUE-FLAG silently became boolean `true`. Callers test
//       `typeof x === "string"`, so `--exam --dry-run` fell to the unscoped
//       branch. Related: `Number("abc")` is NaN which is FALSY, so a cap like
//       `limit ? slice : all` silently widened a smoke test to the FULL run.
//
// The spec parameter is REQUIRED, deliberately. A defaulted one would let every
// existing caller keep the bug by doing nothing — this repo has recorded that
// lesson twice already (docs/OUTSTANDING.md M24). Requiring it makes the
// compiler force each of the callers to declare what it actually accepts.
//
// Validation lives HERE rather than per-call-site because the same defect class
// had already been patched per-call-site twice (`ingest/seed/upsc-syllabus-seed.ts`,
// then `ingest/syllabus.ts`), each fix protecting exactly one script while every
// other caller kept the identical hole.
// ---------------------------------------------------------------------------

/**
 * Which flags a CLI accepts, and what shape each one's value must take.
 *
 * Split by KIND rather than a blanket rule because these CLIs legitimately mix
 * bare booleans with value flags — a blanket "every flag takes a value" (or the
 * reverse) would break real invocations. The kind is what lets the parser know,
 * for example, that `--dry-run` must NOT swallow a following bare word.
 */
export interface FlagSpec {
  /** `--key value`, read back as a string. */
  value?: readonly string[];
  /** Bare presence flags (`--dry-run`). Never consume the following token. */
  boolean?: readonly string[];
  /** `--key N` where N must be an INTEGER strictly greater than zero. */
  positiveInt?: readonly string[];
  /**
   * `--key N` where N must be a FINITE number strictly greater than zero.
   * Fractional values are allowed — use this for budget/threshold flags such as
   * `--max-usd 2.5`, which a positive-INTEGER validator would wrongly reject.
   */
  positiveNumber?: readonly string[];
  /**
   * `--key N` where N must be a FINITE number greater than or equal to zero.
   *
   * Distinct from `positiveNumber` because ZERO IS A MEANINGFUL VALUE for some
   * flags and must not be rejected: `ca:run --wait 0` means "submit the batch and
   * exit without polling", which is exactly what the cron does. Forcing that
   * through a strictly-positive validator would break the scheduled run.
   */
  nonNegativeNumber?: readonly string[];
}

/** Every flag name in a spec, regardless of kind. */
function allSpecFlags(spec: FlagSpec): string[] {
  return [
    ...(spec.value ?? []),
    ...(spec.boolean ?? []),
    ...(spec.positiveInt ?? []),
    ...(spec.positiveNumber ?? []),
    ...(spec.nonNegativeNumber ?? []),
  ];
}

/**
 * Guard the SPEC itself. These are authoring mistakes in the calling script, not
 * operator errors, and each one would silently disable the protection: a flag
 * written as `"--dry-run"` (with dashes) can never match the parsed key
 * `"dry-run"`, so the real flag would be rejected as unknown forever.
 */
function assertSpecWellFormed(spec: FlagSpec, scriptName: string): void {
  const all = allSpecFlags(spec);
  const dashed = all.filter((f) => f.startsWith("-"));
  if (dashed.length > 0) {
    throw new Error(
      `[${scriptName}] FlagSpec is malformed: ${dashed.map((f) => `"${f}"`).join(", ")} start with a dash. ` +
        `Declare flag names WITHOUT the leading "--" (write "dry-run", not "--dry-run") — the parser strips ` +
        `it before matching, so a dashed entry could never match and the real flag would be rejected as unknown.`,
    );
  }
  // A flag named `__proto__` would be SILENTLY LOST: the parsed record is a plain
  // object literal, so `out["__proto__"] = v` sets the prototype rather than an
  // own property, and the caller reads back `undefined` — a value-flag that
  // vanishes, i.e. exactly the silent-misparse class this parser exists to stop.
  // Unreachable today (an undeclared `--__proto__` is rejected as unknown), so
  // this closes the only path that could reach it.
  const reserved = all.filter((f) => f === "__proto__" || f === "constructor" || f === "prototype");
  if (reserved.length > 0) {
    throw new Error(
      `[${scriptName}] FlagSpec is malformed: ${reserved.map((f) => `"${f}"`).join(", ")} ${
        reserved.length === 1 ? "is a" : "are"
      } reserved JavaScript object key(s) and cannot be used as a flag name — the parsed value would be ` +
        `silently dropped (or would mutate the result's prototype). Rename the flag.`,
    );
  }
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const f of all) {
    if (seen.has(f)) dupes.add(f);
    seen.add(f);
  }
  if (dupes.size > 0) {
    throw new Error(
      `[${scriptName}] FlagSpec is malformed: ${[...dupes].map((f) => `"${f}"`).join(", ")} declared under more ` +
        `than one kind. A flag must be exactly one of value / boolean / positiveInt / positiveNumber — the kind ` +
        `decides whether it consumes the next argv token, so a flag in two kinds has ambiguous parse behaviour.`,
    );
  }
}

/**
 * Parse `--key value` / `--key=value` / `--flag` CLI args against a required
 * schema, throwing on ANY argv this script does not fully understand.
 *
 * Returns the same `Record<string, string | boolean>` shape as before, so call
 * sites keep their existing reads (`typeof args.x === "string"`, `!!args.flag`).
 * Numeric flags are VALIDATED here but still returned as strings — an existing
 * `Number(args.limit)` therefore keeps working and is now guaranteed safe.
 *
 * @param argv       usually `process.argv.slice(2)`
 * @param spec       the flags this script accepts (REQUIRED — see the note above)
 * @param scriptName name used in error messages, e.g. `"ingest:syllabus"`
 */
export function parseArgs(
  argv: string[],
  spec: FlagSpec,
  scriptName = "cli",
): Record<string, string | boolean> {
  assertSpecWellFormed(spec, scriptName);

  const valueFlags = new Set([
    ...(spec.value ?? []),
    ...(spec.positiveInt ?? []),
    ...(spec.positiveNumber ?? []),
    ...(spec.nonNegativeNumber ?? []),
  ]);
  const boolFlags = new Set(spec.boolean ?? []);
  const known = new Set(allSpecFlags(spec));

  const out: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const unknown: string[] = [];
  const valueless: string[] = [];
  const valuedBooleans: string[] = [];
  const duplicated: string[] = [];
  const emptyValues: string[] = [];
  const seenFlags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // (a) A bare positional. Checked first because it is the one shape the other
    // checks structurally cannot see — the old parser skipped it entirely.
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }

    // `--key=value` is accepted and split here. Under the old parser this landed
    // as the nonsense key "key=value" — the same silent-misparse class as (b).
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inlineValue = eq === -1 ? null : a.slice(eq + 1);

    if (!known.has(key)) {
      unknown.push(key);
      continue;
    }

    // The same flag twice silently kept the LAST occurrence. That is a
    // silent-wrong-scope: `--paper A --paper B` runs against B while the operator
    // may well have meant A (easy to hit when a pnpm script pre-supplies a flag,
    // e.g. `qgen:topup` supplies `--topup`, and the caller adds their own).
    if (seenFlags.has(key)) duplicated.push(key);
    seenFlags.add(key);

    if (boolFlags.has(key)) {
      // `--dry-run=false` reads as "off" to a human but is truthy here. Refuse
      // rather than silently enabling the very thing the operator disabled.
      if (inlineValue !== null) valuedBooleans.push(key);
      else out[key] = true;
      // NOTE: deliberately no `i++`. A boolean flag must NOT consume the next
      // token — that is what turns `--dry-run somepaper` into a caught
      // positional instead of a silently swallowed argument.
      continue;
    }

    // A value flag.
    if (inlineValue !== null) {
      // `--paper=` is an EMPTY value, not an absent one. Callers test
      // `typeof x === "string"`, which an empty string passes — so it flows into
      // a query/filter as "" and silently matches nothing, or (worse) falls
      // through a `?? default` that was meant to catch "not supplied".
      if (inlineValue === "") emptyValues.push(key);
      else out[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      valueless.push(key);
      continue;
    }
    // Same reasoning as the inline case above — `--paper ""` is an empty value,
    // which every `typeof x === "string"` caller accepts as if it were real.
    if (next === "") {
      emptyValues.push(key);
      i++;
      continue;
    }
    out[key] = next;
    i++;
  }

  // (d) Numeric shape. NaN and 0 are both FALSY, so an unvalidated bad value
  // silently widens a capped run — validate before anything is spent or written.
  const numericProblems: string[] = [];
  for (const k of spec.positiveInt ?? []) {
    const raw = out[k];
    if (typeof raw !== "string") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      numericProblems.push(`--${k} must be a positive integer (got "${raw}")`);
    }
  }
  for (const k of spec.positiveNumber ?? []) {
    const raw = out[k];
    if (typeof raw !== "string") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      numericProblems.push(`--${k} must be a positive number (got "${raw}")`);
    }
  }
  for (const k of spec.nonNegativeNumber ?? []) {
    const raw = out[k];
    if (typeof raw !== "string") continue;
    const n = Number(raw);
    // `Number("")` is 0, which would pass a bare `>= 0` test — reject the empty
    // string explicitly so `--wait ""` cannot masquerade as a valid 0.
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
      numericProblems.push(`--${k} must be a number >= 0 (got "${raw}")`);
    }
  }

  if (
    positionals.length === 0 &&
    unknown.length === 0 &&
    valueless.length === 0 &&
    valuedBooleans.length === 0 &&
    duplicated.length === 0 &&
    emptyValues.length === 0 &&
    numericProblems.length === 0
  ) {
    return out;
  }

  // Aggregate every problem into ONE error, ordered most-diagnostic first, so an
  // operator fixing an invocation sees all of it at once instead of peeling off
  // one error per re-run.
  const knownList = [...known].sort().map((k) => `--${k}`).join(", ");
  const lines: string[] = [`[${scriptName}] refusing to run — this argv was not parsed the way you intended.`, ""];

  if (positionals.length > 0) {
    lines.push(
      `  • Unexpected positional argument(s): ${positionals.map((p) => `"${p}"`).join(", ")}`,
      `      This script takes no positional arguments — every input is a --flag.`,
      `      A bare positional is IGNORED by the parser, so the run would silently fall back`,
      `      to its default (unscoped) behaviour. Did you mean a flag, e.g. --exam ${positionals[0]}?`,
    );
  }
  if (unknown.length > 0) {
    lines.push(`  • Unrecognised flag(s): ${unknown.map((k) => `--${k}`).join(", ")}`);
    // The incident's exact fingerprint. A generic "unknown flag" would leave an
    // operator hunting a typo that does not exist.
    const collapsed = unknown.filter((k) => /\s/.test(k));
    if (collapsed.length > 0) {
      lines.push(
        `      ⚑ ${collapsed.map((k) => `"--${k}"`).join(", ")} contains WHITESPACE, so several flags arrived as a`,
        `        SINGLE argv token — your shell did not word-split them. Note zsh does NOT`,
        `        word-split an unquoted "$var"; use an array ("\${args[@]}") or quote each flag`,
        `        separately. This exact shape caused the 2026-07-31 production incident: the`,
        `        intended flags were silently absent AND a --dry-run was swallowed.`,
      );
    }
  }
  if (valueless.length > 0) {
    lines.push(
      `  • Flag(s) requiring a value but given none: ${valueless.map((k) => `--${k}`).join(", ")}`,
      `      A valueless value-flag used to become boolean \`true\`, which every caller reads as`,
      `      "not set" — silently widening or redirecting the run.`,
    );
  }
  if (valuedBooleans.length > 0) {
    lines.push(
      `  • Boolean flag(s) given a value: ${valuedBooleans.map((k) => `--${k}=…`).join(", ")}`,
      `      These are presence flags — pass \`--${valuedBooleans[0]}\` to enable, or omit it to disable.`,
      `      \`--${valuedBooleans[0]}=false\` reads as "off" but would be truthy, enabling what you meant to turn off.`,
    );
  }
  if (duplicated.length > 0) {
    lines.push(
      `  • Flag(s) given more than once: ${[...new Set(duplicated)].map((k) => `--${k}`).join(", ")}`,
      `      Only the LAST occurrence used to win, silently — so a repeated --paper/--exam would`,
      `      scope the run to something other than what the first one said. Pass each flag once.`,
    );
  }
  if (emptyValues.length > 0) {
    lines.push(
      `  • Flag(s) given an EMPTY value: ${[...new Set(emptyValues)].map((k) => `--${k}`).join(", ")}`,
      `      An empty string is not "not supplied": it passes a \`typeof x === "string"\` check, so it`,
      `      reaches queries and filters as "" and silently matches nothing. Give a real value, or`,
      `      omit the flag entirely to get its default.`,
    );
  }
  if (numericProblems.length > 0) {
    lines.push(
      ...numericProblems.map((p) => `  • ${p}`),
      `      Any non-positive-numeric value is FALSY here (a non-numeric one parses to NaN, and 0 is`,
      `      falsy outright), so it would silently widen a capped run to the full one.`,
    );
  }

  lines.push("", `  Known flags: ${knownList || "(none — this script takes no flags)"}`);
  throw new Error(lines.join("\n"));
}
