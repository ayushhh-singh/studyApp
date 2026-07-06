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
// (paper_code, path) upsert key never collides across exam stages.
// ---------------------------------------------------------------------------
export type ExamStage = "prelims" | "mains";

export interface PaperDef {
  paperCode: string;
  stage: ExamStage;
  title: I18n;
}

export const PAPERS: PaperDef[] = [
  // Prelims
  {
    paperCode: "PRE_GS1",
    stage: "prelims",
    title: { hi: "प्रारंभिक — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Prelims — General Studies Paper I" },
  },
  {
    paperCode: "PRE_CSAT",
    stage: "prelims",
    title: { hi: "प्रारंभिक — सी-सैट (सामान्य अध्ययन द्वितीय प्रश्नपत्र)", en: "Prelims — CSAT (General Studies Paper II)" },
  },
  // Reformed Mains (8 papers)
  {
    paperCode: "MAINS_GH",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य हिन्दी", en: "Mains — General Hindi" },
  },
  {
    paperCode: "MAINS_ESSAY",
    stage: "mains",
    title: { hi: "मुख्य — निबंध", en: "Mains — Essay" },
  },
  {
    paperCode: "MAINS_GS1",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन प्रथम प्रश्नपत्र", en: "Mains — General Studies Paper I" },
  },
  {
    paperCode: "MAINS_GS2",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन द्वितीय प्रश्नपत्र", en: "Mains — General Studies Paper II" },
  },
  {
    paperCode: "MAINS_GS3",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन तृतीय प्रश्नपत्र", en: "Mains — General Studies Paper III" },
  },
  {
    paperCode: "MAINS_GS4",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन चतुर्थ प्रश्नपत्र", en: "Mains — General Studies Paper IV" },
  },
  {
    paperCode: "MAINS_GS5",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन पंचम प्रश्नपत्र (उत्तर प्रदेश विशेष)", en: "Mains — General Studies Paper V (UP-specific)" },
  },
  {
    paperCode: "MAINS_GS6",
    stage: "mains",
    title: { hi: "मुख्य — सामान्य अध्ययन षष्ठम प्रश्नपत्र (उत्तर प्रदेश विशेष)", en: "Mains — General Studies Paper VI (UP-specific)" },
  },
];

export function paperByCode(code: string): PaperDef | undefined {
  return PAPERS.find((p) => p.paperCode === code);
}

// ---------------------------------------------------------------------------
// Multi-exam attribution + source provenance (matches the questions columns
// added in migration 0036).
// ---------------------------------------------------------------------------
export type ExamCode = "uppsc" | "upsc" | "up_ro_aro" | "upsssc_pet" | "other";
export type SourceKind = "official" | "compilation" | "generated" | "manual";

const EXAM_PREFIXES: ExamCode[] = ["uppsc", "upsc", "up_ro_aro", "upsssc_pet"];

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

const GOV_DOMAINS = ["upsc.gov.in", "uppsc.up.nic.in", "gov.in", "nic.in", "upload.wikimedia.org"];

/** Provenance tier for a fetched source — prefer the stamped tier, else infer from the URL host. */
export function sourceKindForEntry(entry: ManifestEntry): SourceKind {
  const tier = entry.tier ?? (GOV_DOMAINS.some((d) => entry.url.includes(d)) ? "A" : "B");
  return tier === "A" ? "official" : "compilation";
}

/** True when the source is a Tier-B third-party compilation (stricter extraction rules apply). */
export function isCompilationEntry(entry: ManifestEntry): boolean {
  return sourceKindForEntry(entry) === "compilation";
}

/**
 * Map a PYQ manifest id to {examCode, paperCode, year, stage}. Handles all
 * exams (uppsc/upsc/up_ro_aro/upsssc_pet) — e.g. uppsc_mains_2025_gs5,
 * upsc_prelims_2024_gs1. Non-UPPSC objective exams (RO/ARO, PET) map their GS
 * papers onto the shared UPPSC prelims syllabus (PRE_GS1) for weightage overlap;
 * questions beyond that scope are kept out_of_syllabus at load. Returns null for
 * anything we can't confidently place.
 */
export function classifyPyqId(
  id: string,
): { examCode: ExamCode; paperCode: string; year: number; stage: ExamStage } | null {
  const m = id.match(/^(uppsc|upsc|up_ro_aro|upsssc_pet)_(prelims|mains)_(\d{4})_([a-z0-9_]+?)(_mirror)?$/);
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
  const paperCode = map[paperRaw];
  if (!paperCode) return null;
  return { examCode, paperCode, year, stage };
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

/** Parse simple `--key value` / `--flag` CLI args into a record. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
