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
  classifyPyqId,
  paperByCode,
  ensureParsedDir,
  PARSED_DIR,
  parseArgs,
  report,
  i18nComplete,
  isMojibakeHindi,
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
// 1. Extraction (sonnet native PDF read, with recursive halving on truncation)
// ---------------------------------------------------------------------------
async function extractRange(
  entry: ManifestEntry,
  isMcq: boolean,
  from: number,
  to: number,
): Promise<RawQuestion[]> {
  const doc = await pdfDocumentBlock(absPath(entry));
  const kind = isMcq
    ? "This is a Prelims MCQ paper. Each question has a stem and options " +
      "(A/B/C/D). Extract each option's key + bilingual text. Set type='mcq', " +
      "word_limit=0. Leave correct_option_key='' (the answer key is applied " +
      "separately)."
    : "This is a Mains descriptive paper. Questions have NO options. Set " +
      "type='descriptive', options=[], correct_option_key='', and set " +
      "word_limit from the paper's instructions when stated (else 0).";
  const system =
    "You extract UPPSC previous-year questions from the attached PDF into " +
    "structured JSON. The paper is bilingual (Hindi + English). Capture BOTH " +
    "languages faithfully in Devanagari and English. Preserve question numbers. " +
    "Do not translate, invent, or answer — transcribe. Use marks from the paper " +
    "when printed, else 0.";
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

async function extractAll(entry: ManifestEntry, isMcq: boolean): Promise<RawQuestion[]> {
  // Prelims papers can have ~150 questions; mains ~20. Start wide, halve the
  // window on any suspected truncation (structuredJson throws on truncation).
  const byNo = new Map<number, RawQuestion>();
  const windows: [number, number][] = [[1, 250]];
  while (windows.length) {
    const [from, to] = windows.shift()!;
    try {
      const qs = await extractRange(entry, isMcq, from, to);
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
  year: number,
  paperCode: string,
): Promise<Map<number, string> | null> {
  // Answer-key ids look like uppsc_answerkey_2024_prelims_gs1 / _csat.
  const suffix = paperCode === "PRE_CSAT" ? "csat" : "gs1";
  const id = `uppsc_answerkey_${year}_prelims_${suffix}`;
  const entry = manifest.find((e) => e.id === id && e.status === "ok");
  if (!entry) return null;
  const out = await structuredJson<{ answers: { q_no: number; correct_option_key: string }[] }>({
    model: MODELS.sonnet,
    system:
      "You read an official UPPSC answer key PDF and return the correct option " +
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
    stage: "prelims" | "mains";
    paperCode: string;
    year: number;
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

  let explanation: ParsedQuestion["explanation_i18n"] = null;
  if (raw.explanation_hi.trim() || raw.explanation_en.trim()) {
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

  const bilingualComplete =
    i18nComplete(stem.v) &&
    (raw.type !== "mcq" ||
      (!!options && options.length >= 2 && options.every((o) => i18nComplete(o.text_i18n)) && !!correct));

  return {
    external_id: `pyq:${ctx.manifestId}:q${raw.q_no}`,
    type: raw.type,
    stage: ctx.stage,
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
  const entry = manifest.find((e) => e.id === manifestId && e.status === "ok");
  if (!entry) throw new Error(`No manifest entry with id=${manifestId}`);
  const cls = classifyPyqId(manifestId);
  if (!cls) throw new Error(`Cannot classify paper from id ${manifestId}`);
  const paper = paperByCode(cls.paperCode);
  if (!paper) throw new Error(`Unknown paper_code ${cls.paperCode}`);
  const isMcq = cls.stage === "prelims";

  report.step(`paper: ${cls.paperCode} (${paper.title.en}) · year ${cls.year} · ${cls.stage} · ${isMcq ? "MCQ" : "descriptive"}`);
  const info = await extractPdf(absPath(entry));
  report.step(`source PDF: ${entry.path} (${info.pageCount}p${info.likelyScanned ? ", scanned → vision" : ""})`);

  // 1. Extract
  report.section("Extracting questions (claude-sonnet-5, native PDF read)");
  const raw = await extractAll(entry, isMcq);
  report.ok(`extracted ${raw.length} questions`);
  if (raw.length === 0) throw new Error("No questions extracted.");

  // 2. Answer key (prelims)
  let answerKey: Map<number, string> | null = null;
  if (isMcq) {
    report.section("Answer-key cross-check");
    answerKey = await loadAnswerKey(manifest, cls.year, cls.paperCode);
    if (answerKey) report.ok(`official answer key loaded (${answerKey.size} answers)`);
    else report.warn("no official answer key available for this paper");
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
      stage: cls.stage,
      paperCode: cls.paperCode,
      year: cls.year,
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

  // Write parsed JSON for review
  await ensureParsedDir();
  const outPath = join(PARSED_DIR, `pyq_${manifestId}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        source: { manifest_id: manifestId, path: entry.path, ...cls },
        summary: {
          questions: parsed.length,
          bilingual_complete: bilingual,
          machine_translated: mt,
          answer_key_verified: verified,
          answer_key_mismatches: mismatches.length,
          syllabus_classified: classified,
        },
        questions: parsed,
      },
      null,
      2,
    ),
  );

  report.section("Parsed — STOPPING for your review");
  report.ok(`wrote ${outPath.replace(ROOT + "/", "")}`);
  console.log(`  questions              ${parsed.length}`);
  console.log(`  bilingual-complete     ${bilingual}/${parsed.length}`);
  console.log(`  machine-translated     ${mt}`);
  console.log(`  syllabus-classified    ${classified}/${parsed.length}`);
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
