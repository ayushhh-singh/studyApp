/**
 * ingest:pyq — parse ONE previous-year question paper into structured,
 * reviewable JSON. This step NEVER writes to the questions table; it writes
 * content-raw/parsed/pyq_<id>.json and stops for human review. The reviewed
 * JSON is loaded by `ingest:pyq:load`.
 *
 *   pnpm ingest:pyq --id uppsc_prelims_2024_gs1
 *   pnpm ingest:pyq --csv content-raw/pyq/my_questions.csv   (structured CSV path)
 *
 * Pipeline (per the brief):
 *   1. Structured CSV path (year,paper,question,options A-D,answer,...), OR
 *      PDF path: claude-sonnet-5 reads the PDF natively (best for bilingual
 *      2-column papers; pdf-parse mangles Devanagari) under a STRICT JSON
 *      contract. Scanned PDFs are handled by the same vision read.
 *   2. Cross-check MCQ answers against the official answer key (where present)
 *      and flag mismatches.
 *   3. Map each question to a syllabus_node via a claude-haiku-4-5
 *      classification pass (given the paper's syllabus tree).
 *   4. Fill both languages (haiku), flag meta.machine_translated.
 *   5. Write parsed/pyq_<id>.json and STOP.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { structuredJson, translateBatch, MODELS } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import {
  ROOT,
  readManifest,
  absPath,
  extractPdf,
  pdfDocumentBlock,
  pdfSubsetDocumentBlock,
  classifyPyqId,
  paperByCode,
  ensureParsedDir,
  PARSED_DIR,
  parseArgs,
  report,
  isMojibakeHindi,
  questionPublishable,
  examLabel,
  sourceKindForEntry,
  isCompilationEntry,
  type ExamCode,
  type SourceKind,
  type ManifestEntry,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// Types + schemas
// ---------------------------------------------------------------------------
interface RawQuestion {
  q_no: number;
  type: "mcq" | "descriptive";
  stem_en: string;
  stem_hi: string;
  options: { key: string; text_en: string; text_hi: string }[];
  correct_option_key: string;
  explanation_en: string;
  explanation_hi: string;
  marks: number;
  word_limit: number;
  /**
   * Tier-B gate: true only when this is a genuine question from the stated
   * (exam, year) paper. The model marks compiler-added "practice"/"model"
   * questions false so they're skipped — we never ingest a compiler's own Qs.
   */
  attributed: boolean;
}

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          q_no: { type: "integer" },
          type: { type: "string", enum: ["mcq", "descriptive"] },
          stem_en: { type: "string" },
          stem_hi: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                text_en: { type: "string" },
                text_hi: { type: "string" },
              },
              required: ["key", "text_en", "text_hi"],
            },
          },
          correct_option_key: { type: "string" },
          explanation_en: { type: "string" },
          explanation_hi: { type: "string" },
          marks: { type: "integer" },
          word_limit: { type: "integer" },
          attributed: { type: "boolean" },
        },
        required: [
          "q_no",
          "type",
          "stem_en",
          "stem_hi",
          "options",
          "correct_option_key",
          "explanation_en",
          "explanation_hi",
          "marks",
          "word_limit",
          "attributed",
        ],
      },
    },
  },
  required: ["questions"],
} as const;

// Final reviewable question shape written to parsed/*.json.
interface ParsedQuestion {
  external_id: string;
  type: "mcq" | "descriptive";
  stage: "prelims" | "mains";
  exam_code: ExamCode;
  exam_label_i18n: { hi: string; en: string };
  source_kind: SourceKind;
  source_ref: string;
  out_of_syllabus: boolean;
  paper_code: string;
  year: number;
  q_no: number;
  stem_i18n: { hi: string; en: string };
  options_i18n: { key: string; text_i18n: { hi: string; en: string } }[] | null;
  correct_option_key: string | null;
  explanation_i18n: { hi: string; en: string } | null;
  difficulty: "easy" | "medium" | "hard";
  marks: number | null;
  word_limit: number | null;
  syllabus_paper_code: string;
  syllabus_path: string | null;
  is_bilingual_complete: boolean;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Extraction (sonnet native PDF read, with recursive halving on truncation;
//    page-chunked fallback for scans too large to attach whole).
// ---------------------------------------------------------------------------
type ExtractCtx = { examLabelEn: string; year: number; isCompilation: boolean };

function buildExtractSystem(isMcq: boolean, ctx: ExtractCtx): { system: string; kind: string } {
  const kind = isMcq
    ? "This is a Prelims MCQ paper. Each question has a stem and options. " +
      "Each option's `key` MUST be the single printed option letter A, B, C, or " +
      "D (uppercase) — NEVER put statement text, commas, numbers, or Match-List " +
      "answer codes in `key`; those belong in the option's text. For Match-List " +
      "/ statement questions, the four answer combinations are the options A-D. " +
      "Set type='mcq', word_limit=0, and leave correct_option_key='' (the answer " +
      "key is applied separately)."
    : "This is a Mains descriptive paper. Questions have NO options. Set " +
      "type='descriptive', options=[], correct_option_key='', and set " +
      "word_limit from the paper's instructions when stated (else 0).";
  // Tier-B (third-party compilation) rules — enforced in the prompt, then again
  // in code: (1) attribution — only extract genuine questions from the stated
  // exam+year paper; mark any compiler-added "practice"/"model"/"similar"
  // question attributed=false. (2) never copy the compiler's solutions —
  // ALWAYS leave explanation_en/explanation_hi empty; our own pipeline writes
  // explanations later. For official (Tier-A) sources, set attributed=true and
  // transcribe any printed explanation.
  const provenance = ctx.isCompilation
    ? `This is a THIRD-PARTY COMPILATION that republishes the ${ctx.examLabelEn} ${ctx.year} ` +
      `paper. Extract ONLY the genuine questions that actually appeared in that exam paper; ` +
      `set attributed=true for those and attributed=false for any question the compiler ADDED ` +
      `(practice/model/"similar"/solved-example questions that were not in the real paper). ` +
      `Do NOT copy the compiler's explanations, solutions, notes, or answer rationales into ANY ` +
      `field — always return explanation_en="" and explanation_hi="". Take only the question ` +
      `stem, its options, and (for MCQs) leave the answer to the separate key step.`
    : `This is an official ${ctx.examLabelEn} ${ctx.year} paper. Set attributed=true for every ` +
      `question. Transcribe a printed explanation only if one appears in the paper itself.`;
  const system =
    `You extract ${ctx.examLabelEn} previous-year questions from the attached PDF into ` +
    "structured JSON. The paper is bilingual (Hindi + English). Capture BOTH " +
    "languages faithfully in Devanagari and English. Preserve question numbers. " +
    "Do not translate, invent, or answer — transcribe. Use marks from the paper " +
    `when printed, else 0. ${provenance}`;
  return { system, kind };
}

async function extractRange(
  entry: ManifestEntry,
  isMcq: boolean,
  from: number,
  to: number,
  ctx: ExtractCtx,
): Promise<RawQuestion[]> {
  const doc = await pdfDocumentBlock(absPath(entry));
  const { system, kind } = buildExtractSystem(isMcq, ctx);
  const out = await structuredJson<{ questions: RawQuestion[] }>({
    model: MODELS.sonnet,
    system,
    content: [
      doc,
      {
        type: "text",
        text:
          `${kind}\n\nExtract ONLY questions numbered ${from} to ${to} ` +
          `(inclusive). If the paper has fewer, return only those that exist. ` +
          `Return them in order.`,
      },
    ],
    schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 120000,
    effort: "medium",
  });
  return out.questions.filter((q) => q.q_no >= from && q.q_no <= to);
}

/** How complete an extraction is — for picking the better copy of a q_no seen in two overlapping chunks. */
function completeness(q: RawQuestion): number {
  return q.options.length * 1000 + (q.stem_en?.length ?? 0) + (q.stem_hi?.length ?? 0);
}

/** Extract every question fully visible on a subset of pages (large-scan path). */
async function extractPageChunk(
  entry: ManifestEntry,
  isMcq: boolean,
  pageIndices: number[],
  ctx: ExtractCtx,
): Promise<RawQuestion[]> {
  const doc = await pdfSubsetDocumentBlock(absPath(entry), pageIndices);
  const { system, kind } = buildExtractSystem(isMcq, ctx);
  const out = await structuredJson<{ questions: RawQuestion[] }>({
    model: MODELS.sonnet,
    system,
    content: [
      doc,
      {
        type: "text",
        text:
          `${kind}\n\nThe attached PDF contains only SOME pages of the paper. Extract EVERY ` +
          `question that appears in FULL on these pages, preserving its printed question number. ` +
          `Skip a question if it is only partially visible (cut off at a page edge) — it will be ` +
          `captured with its neighbouring pages. Return them in question-number order.`,
      },
    ],
    schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 64000,
    effort: "medium",
  });
  return out.questions;
}

/**
 * Whole-PDF extraction (default): attach the full PDF, extract by question
 * window, halving on truncation. Used when the PDF is small enough to attach.
 */
async function extractWhole(entry: ManifestEntry, isMcq: boolean, ctx: ExtractCtx): Promise<RawQuestion[]> {
  const byNo = new Map<number, RawQuestion>();
  const windows: [number, number][] = [[1, 250]];
  while (windows.length) {
    const [from, to] = windows.shift()!;
    try {
      const qs = await extractRange(entry, isMcq, from, to, ctx);
      for (const q of qs) byNo.set(q.q_no, q);
      report.step(`extracted q${from}-${to}: +${qs.length}`);
    } catch (err) {
      if (to - from >= 10) {
        const mid = Math.floor((from + to) / 2);
        report.warn(`q${from}-${to} failed (${(err as Error).message}); splitting`);
        windows.unshift([from, mid], [mid + 1, to]);
      } else {
        report.fail(`q${from}-${to} failed permanently: ${(err as Error).message}`);
      }
    }
  }
  return [...byNo.values()].sort((a, b) => a.q_no - b.q_no);
}

/**
 * Page-chunked extraction: for a scan too large to attach whole, walk the pages
 * in overlapping windows (overlap catches a question split across a boundary),
 * extracting per chunk and merging by question number (keeping the more
 * complete copy).
 */
async function extractByPages(
  entry: ManifestEntry,
  isMcq: boolean,
  ctx: ExtractCtx,
  pageCount: number,
): Promise<RawQuestion[]> {
  const CHUNK = 8;
  // Overlap 2 pages so a question spanning up to 3 pages across a chunk boundary
  // is still captured whole by at least one chunk (1 page of overlap could drop
  // a 3-page-span question, cut off in both neighbours).
  const OVERLAP = 2;
  const byNo = new Map<number, RawQuestion>();
  for (let start = 0; start < pageCount; start += CHUNK - OVERLAP) {
    const pages: number[] = [];
    for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) pages.push(p);
    if (pages.length === 0) break;
    try {
      const qs = await extractPageChunk(entry, isMcq, pages, ctx);
      for (const q of qs) {
        const existing = byNo.get(q.q_no);
        if (!existing || completeness(q) > completeness(existing)) byNo.set(q.q_no, q);
      }
      report.step(`pages ${pages[0] + 1}-${pages[pages.length - 1] + 1}: +${qs.length} (total ${byNo.size})`);
    } catch (err) {
      report.warn(`pages ${pages[0] + 1}-${pages[pages.length - 1] + 1} failed: ${(err as Error).message}`);
    }
    if (start + CHUNK >= pageCount) break;
  }
  return [...byNo.values()].sort((a, b) => a.q_no - b.q_no);
}

/** Anthropic's request cap is ~32MB; a PDF base64-encodes ~1.37x, so anything
 * over ~18MB can't be attached whole → use the page-chunked path. */
const WHOLE_PDF_MAX_BYTES = 18_000_000;

async function extractAll(
  entry: ManifestEntry,
  isMcq: boolean,
  ctx: ExtractCtx,
  pageCount: number,
): Promise<RawQuestion[]> {
  const bytes = entry.bytes ?? 0;
  if (bytes > WHOLE_PDF_MAX_BYTES && pageCount > 1) {
    report.step(
      `PDF is ${(bytes / 1_048_576).toFixed(0)}MB (> ${(WHOLE_PDF_MAX_BYTES / 1_048_576).toFixed(0)}MB) — ` +
        `extracting page-by-page (${pageCount} pages)`,
    );
    return extractByPages(entry, isMcq, ctx, pageCount);
  }
  // Prelims papers can have ~150 questions; mains ~20. Start wide, halve the
  // window on any suspected truncation (structuredJson throws on truncation).
  return extractWhole(entry, isMcq, ctx);
}

// ---------------------------------------------------------------------------
// 2. Official answer key (prelims only, where available)
// ---------------------------------------------------------------------------
const ANSWER_KEY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          q_no: { type: "integer" },
          correct_option_key: { type: "string" },
        },
        required: ["q_no", "correct_option_key"],
      },
    },
  },
  required: ["answers"],
} as const;

async function loadAnswerKey(
  manifest: ManifestEntry[],
  examCode: ExamCode,
  year: number,
  paperCode: string,
): Promise<Map<number, string> | null> {
  // Answer-key ids look like <exam>_answerkey_<year>_prelims_gs1 / _csat. The
  // candidates are SCOPED TO THIS EXAM ONLY — never fall back to another exam's
  // key (a same-year UPPSC key must not be applied to UPSC questions).
  const suffix = paperCode === "PRE_CSAT" ? "csat" : "gs1";
  const candidates = [
    `${examCode}_answerkey_${year}_prelims_${suffix}`,
    // Tier-B mirror key (used when the official key is unreachable and a mirror
    // paper/key pair carries the `_mirror` suffix to avoid an id collision).
    `${examCode}_answerkey_${year}_prelims_${suffix}_mirror`,
  ];
  // Iterate `candidates` in priority order (NOT the sorted manifest) so the
  // exact-exam id wins rather than whichever id happens to sort first.
  let entry: ManifestEntry | undefined;
  for (const id of candidates) {
    entry = manifest.find((e) => e.id === id && (e.status === "ok" || e.status === "manual"));
    if (entry) break;
  }
  if (!entry) return null;
  const out = await structuredJson<{ answers: { q_no: number; correct_option_key: string }[] }>({
    model: MODELS.sonnet,
    system:
      "You read an official exam answer-key PDF and return the correct option " +
      "(A/B/C/D) for each question number. Return uppercase single letters.",
    content: [
      await pdfDocumentBlock(absPath(entry)),
      { type: "text", text: "Extract the question-number → correct-option map." },
    ],
    schema: ANSWER_KEY_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 32000,
  });
  const map = new Map<number, string>();
  for (const a of out.answers) map.set(a.q_no, a.correct_option_key.trim().toUpperCase());
  return map;
}

// ---------------------------------------------------------------------------
// 3. Syllabus classification (haiku, batched)
// ---------------------------------------------------------------------------
interface SyllabusNode {
  path: string;
  title_en: string;
}

async function loadSyllabusTree(paperCode: string): Promise<SyllabusNode[]> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("path, title_i18n")
    .eq("paper_code", paperCode)
    .neq("path", "");
  if (error) throw new Error(`load syllabus for ${paperCode}: ${error.message}`);
  return (data ?? []).map((n) => ({
    path: n.path as string,
    title_en: (n.title_i18n as { en?: string })?.en ?? "",
  }));
}

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          q_no: { type: "integer" },
          path: { type: "string" },
        },
        required: ["q_no", "path"],
      },
    },
  },
  required: ["mappings"],
} as const;

async function classify(
  questions: RawQuestion[],
  tree: SyllabusNode[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (tree.length === 0) return result;
  const treeText = tree.map((n) => `${n.path} :: ${n.title_en}`).join("\n");
  const batchSize = 30;
  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    const qText = batch
      .map((q) => `q${q.q_no}: ${q.stem_en.slice(0, 300)}`)
      .join("\n");
    const out = await structuredJson<{ mappings: { q_no: number; path: string }[] }>({
      model: MODELS.haiku,
      system:
        "You map each UPPSC question to the single best-matching syllabus node. " +
        "Choose ONLY from the provided paths. If none fit, return an empty path.",
      content:
        `SYLLABUS NODES (path :: title):\n${treeText}\n\n` +
        `QUESTIONS:\n${qText}\n\n` +
        "Return one mapping per question with the best path (or '' if none).",
      schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4000,
    });
    const valid = new Set(tree.map((n) => n.path));
    for (const m of out.mappings) {
      if (m.path && valid.has(m.path)) result.set(m.q_no, m.path);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 4. Bilingual fill (haiku) + assemble ParsedQuestion
// ---------------------------------------------------------------------------
/**
 * Collect every English string whose Hindi counterpart is missing or mojibake,
 * so we can batch-translate them once (instead of hundreds of single calls),
 * then resolve each field from that map.
 */
function needsHindi(hi: string, en: string): boolean {
  const E = (en ?? "").trim();
  const H = (hi ?? "").trim();
  return !!E && (!H || isMojibakeHindi(H, en));
}

function collectHindiJobs(raw: RawQuestion[]): string[] {
  const jobs: string[] = [];
  for (const q of raw) {
    if (needsHindi(q.stem_hi, q.stem_en)) jobs.push(q.stem_en.trim());
    for (const o of q.options) if (needsHindi(o.text_hi, o.text_en)) jobs.push(o.text_en.trim());
    if (needsHindi(q.explanation_hi, q.explanation_en)) jobs.push(q.explanation_en.trim());
  }
  return jobs;
}

/** Resolve a bilingual pair, using `hiMap` to fill missing/mojibake Hindi. */
function resolveLang(
  hi: string,
  en: string,
  hiMap: Map<string, string>,
): { v: { hi: string; en: string }; machine: boolean } {
  const E = (en ?? "").trim();
  const H = (hi ?? "").trim();
  if (H && !isMojibakeHindi(H, en)) return { v: { hi: H, en: E }, machine: false };
  if (E) {
    const translated = hiMap.get(E);
    if (translated) return { v: { hi: translated, en: E }, machine: true };
  }
  // Fall back to whatever we have (may leave Hindi empty → not publishable).
  return { v: { hi: H && !isMojibakeHindi(H, en) ? H : "", en: E }, machine: false };
}

function assemble(
  raw: RawQuestion,
  hiMap: Map<string, string>,
  ctx: {
    manifestId: string;
    examCode: ExamCode;
    stage: "prelims" | "mains";
    paperCode: string;
    year: number;
    sourceKind: SourceKind;
    isCompilation: boolean;
    answerKey: Map<number, string> | null;
    syllabusPath: string | null;
  },
): ParsedQuestion {
  const meta: Record<string, unknown> = { source_ref: `${ctx.manifestId}#q${raw.q_no}` };
  let machine = false;

  const stem = resolveLang(raw.stem_hi, raw.stem_en, hiMap);
  machine ||= stem.machine;

  let options: ParsedQuestion["options_i18n"] = null;
  if (raw.type === "mcq" && raw.options.length) {
    options = [];
    for (const o of raw.options) {
      const t = resolveLang(o.text_hi, o.text_en, hiMap);
      machine ||= t.machine;
      options.push({ key: o.key.trim().toUpperCase(), text_i18n: t.v });
    }
  }

  // Tier-B rule: NEVER carry a compiler's explanation/solution. Our haiku
  // explain pipeline generates one on demand later instead.
  let explanation: ParsedQuestion["explanation_i18n"] = null;
  if (!ctx.isCompilation && (raw.explanation_hi.trim() || raw.explanation_en.trim())) {
    const e = resolveLang(raw.explanation_hi, raw.explanation_en, hiMap);
    machine ||= e.machine;
    explanation = e.v;
  }

  // Correct answer + answer-key cross-check.
  let correct = raw.correct_option_key.trim().toUpperCase() || null;
  if (raw.type === "mcq" && ctx.answerKey) {
    const official = ctx.answerKey.get(raw.q_no) ?? null;
    if (official) {
      meta.official_answer = official;
      if (!correct) {
        correct = official;
        meta.answer_key_verified = true;
      } else if (correct === official) {
        meta.answer_key_verified = true;
      } else {
        meta.answer_key_mismatch = { extracted: correct, official };
        // Trust the official key as the source of truth; flag for review.
        correct = official;
        meta.answer_key_verified = true;
      }
    }
  }

  if (machine) meta.machine_translated = true;

  // Mirror the DB publish gate exactly (bilingual stem; MCQ also needs >=2
  // clean bilingual options and a correct key that matches one of them). This
  // keeps noisy extractions (mis-keyed Match-List options, blank keys) out of
  // is_published so the load never trips the trigger.
  const bilingualComplete = questionPublishable(raw.type, stem.v, options, correct);
  if (raw.type === "mcq" && !bilingualComplete) meta.needs_review = true;

  // An out-of-exam question that maps to no UPPSC syllabus node is kept as
  // out_of_syllabus rather than force-mapped. (An unmapped UPPSC question is
  // just an unclassified in-syllabus row, not out-of-scope.)
  const outOfSyllabus = !ctx.syllabusPath && ctx.examCode !== "uppsc";

  return {
    external_id: `pyq:${ctx.manifestId}:q${raw.q_no}`,
    type: raw.type,
    stage: ctx.stage,
    exam_code: ctx.examCode,
    exam_label_i18n: examLabel(ctx.examCode, ctx.stage),
    source_kind: ctx.sourceKind,
    source_ref: ctx.manifestId,
    out_of_syllabus: outOfSyllabus,
    paper_code: ctx.paperCode,
    year: ctx.year,
    q_no: raw.q_no,
    stem_i18n: stem.v,
    options_i18n: options,
    correct_option_key: correct,
    explanation_i18n: explanation,
    difficulty: "medium",
    marks: raw.marks > 0 ? raw.marks : null,
    word_limit: raw.word_limit > 0 ? raw.word_limit : null,
    syllabus_paper_code: ctx.paperCode,
    syllabus_path: ctx.syllabusPath,
    is_bilingual_complete: bilingualComplete,
    meta,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestId = typeof args.id === "string" ? args.id : null;
  if (!manifestId) {
    throw new Error(
      "Provide --id <manifest_id>, e.g. --id uppsc_prelims_2024_gs1. " +
        "(CSV ingestion: --csv <path>.)",
    );
  }

  report.section(`ingest:pyq  (parse only — writes JSON for review, NO db writes)`);

  const manifest = await readManifest();
  const entry = manifest.find(
    (e) => e.id === manifestId && (e.status === "ok" || e.status === "manual"),
  );
  if (!entry) throw new Error(`No manifest entry with id=${manifestId}`);
  const cls = classifyPyqId(manifestId);
  if (!cls) throw new Error(`Cannot classify paper from id ${manifestId}`);
  const paper = paperByCode(cls.paperCode);
  if (!paper) throw new Error(`Unknown paper_code ${cls.paperCode}`);
  const isMcq = cls.stage === "prelims";
  const sourceKind = sourceKindForEntry(entry);
  const isCompilation = isCompilationEntry(entry);
  const examLabelEn = examLabel(cls.examCode, cls.stage).en;
  const extractCtx = { examLabelEn, year: cls.year, isCompilation };

  report.step(
    `exam: ${cls.examCode} · paper: ${cls.paperCode} (${paper.title.en}) · year ${cls.year} · ` +
      `${cls.stage} · ${isMcq ? "MCQ" : "descriptive"} · source_kind: ${sourceKind}` +
      (isCompilation ? " (Tier-B compilation → attribution-gated, no solutions copied)" : ""),
  );
  const info = await extractPdf(absPath(entry));
  report.step(`source PDF: ${entry.path} (${info.pageCount}p${info.likelyScanned ? ", scanned → vision" : ""})`);

  // 1. Extract
  report.section("Extracting questions (claude-sonnet-5, native PDF read)");
  const rawAll = await extractAll(entry, isMcq, extractCtx, info.pageCount);
  // Tier-B attribution gate: drop (and count) any compiler-added question that
  // isn't a genuine PYQ of this exam+year. Official sources keep everything.
  const rawSkipped = isCompilation ? rawAll.filter((q) => q.attributed === false) : [];
  const raw = isCompilation ? rawAll.filter((q) => q.attributed !== false) : rawAll;
  report.ok(`extracted ${raw.length} attributed questions`);
  if (rawSkipped.length) {
    report.warn(`skipped ${rawSkipped.length} unattributed (compiler-added) question(s): not ingested`);
  }
  if (raw.length === 0) throw new Error("No questions extracted.");

  // 2. Answer key (prelims)
  let answerKey: Map<number, string> | null = null;
  if (isMcq) {
    report.section("Answer-key cross-check");
    answerKey = await loadAnswerKey(manifest, cls.examCode, cls.year, cls.paperCode);
    if (answerKey) report.ok(`answer key loaded (${answerKey.size} answers)`);
    else report.warn("no answer key available for this paper");
  }

  // 3. Classify
  report.section("Syllabus classification (claude-haiku-4-5)");
  const tree = await loadSyllabusTree(cls.paperCode);
  report.step(`syllabus nodes for ${cls.paperCode}: ${tree.length}`);
  const pathByQ = await classify(raw, tree);
  report.ok(`classified ${pathByQ.size}/${raw.length} questions to a syllabus node`);

  // 4. Assemble (+ bilingual fill). UPPSC PDFs often encode Hindi in a legacy
  // non-Unicode font that extracts as mojibake — detect that, and regenerate
  // Hindi from the clean English via batched haiku translation (flagged).
  report.section("Bilingual fill (claude-haiku-4-5, batched)");
  const jobs = collectHindiJobs(raw);
  const translations = jobs.length ? await translateBatch(jobs, "hi") : [];
  const hiMap = new Map<string, string>();
  jobs.forEach((en, i) => {
    if (translations[i]) hiMap.set(en, translations[i]);
  });
  report.ok(`regenerated Hindi for ${hiMap.size} unique strings (missing or mojibake)`);

  const parsed: ParsedQuestion[] = raw.map((q) =>
    assemble(q, hiMap, {
      manifestId,
      examCode: cls.examCode,
      stage: cls.stage,
      paperCode: cls.paperCode,
      year: cls.year,
      sourceKind,
      isCompilation,
      answerKey,
      syllabusPath: pathByQ.get(q.q_no) ?? null,
    }),
  );

  // Summary numbers
  const bilingual = parsed.filter((q) => q.is_bilingual_complete).length;
  const mt = parsed.filter((q) => (q.meta as { machine_translated?: boolean }).machine_translated).length;
  const verified = parsed.filter((q) => (q.meta as { answer_key_verified?: boolean }).answer_key_verified).length;
  const mismatches = parsed.filter((q) => (q.meta as { answer_key_mismatch?: unknown }).answer_key_mismatch);
  const classified = parsed.filter((q) => q.syllabus_path).length;
  const outOfSyllabus = parsed.filter((q) => q.out_of_syllabus).length;

  // Write parsed JSON for review
  await ensureParsedDir();
  const outPath = join(PARSED_DIR, `pyq_${manifestId}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        source: { manifest_id: manifestId, path: entry.path, source_kind: sourceKind, ...cls },
        summary: {
          questions: parsed.length,
          skipped_unattributed: rawSkipped.length,
          bilingual_complete: bilingual,
          machine_translated: mt,
          answer_key_verified: verified,
          answer_key_mismatches: mismatches.length,
          syllabus_classified: classified,
          out_of_syllabus: outOfSyllabus,
        },
        questions: parsed,
      },
      null,
      2,
    ),
  );

  report.section("Parsed — STOPPING for your review");
  report.ok(`wrote ${outPath.replace(ROOT + "/", "")}`);
  console.log(`  exam / source_kind     ${cls.examCode} / ${sourceKind}`);
  console.log(`  questions              ${parsed.length}`);
  if (isCompilation) console.log(`  skipped unattributed   ${rawSkipped.length}`);
  console.log(`  bilingual-complete     ${bilingual}/${parsed.length}`);
  console.log(`  machine-translated     ${mt}`);
  console.log(`  syllabus-classified    ${classified}/${parsed.length}`);
  if (outOfSyllabus) console.log(`  out-of-syllabus        ${outOfSyllabus}`);
  if (isMcq) {
    console.log(`  answer-key-verified    ${verified}/${parsed.length}`);
    console.log(`  answer-key MISMATCHES   ${mismatches.length}`);
    for (const m of mismatches) {
      const mm = (m.meta as { answer_key_mismatch: { extracted: string; official: string } }).answer_key_mismatch;
      report.warn(`   q${m.q_no}: extracted ${mm.extracted} vs official ${mm.official} (kept official)`);
    }
  }
  console.log(
    `\n  Review the JSON, then load with:\n    pnpm ingest:pyq:load --id ${manifestId}\n`,
  );
}

main().catch((err) => {
  console.error("\ningest:pyq failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
