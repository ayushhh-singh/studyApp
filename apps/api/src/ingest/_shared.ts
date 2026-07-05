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

/**
 * Map a PYQ manifest id (e.g. uppsc_prelims_2024_gs1, uppsc_mains_2025_gs5,
 * uppsc_mains_2024_essay) to {paperCode, year, stage}. Returns null for
 * anything we can't confidently place (e.g. mirror duplicates are handled by
 * the caller preferring the primary).
 */
export function classifyPyqId(
  id: string,
): { paperCode: string; year: number; stage: ExamStage } | null {
  const m = id.match(/^uppsc_(prelims|mains)_(\d{4})_([a-z0-9_]+?)(_mirror)?$/);
  if (!m) return null;
  const [, stageRaw, yearRaw, paperRaw] = m;
  const stage = stageRaw as ExamStage;
  const year = Number(yearRaw);
  const map: Record<string, string> = {
    gs1: stage === "prelims" ? "PRE_GS1" : "MAINS_GS1",
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
  return { paperCode, year, stage };
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
