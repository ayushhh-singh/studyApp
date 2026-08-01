/**
 * ingest:syllabus — build a syllabus_nodes tree from the real downloaded
 * syllabus PDFs. Multi-exam aware: each PaperDef names its own exam, which is
 * stamped onto every node it writes.
 *
 *   pnpm ingest:syllabus [--exam uppsc] [--paper PRE_GS1] [--dry-run] [--limit-nodes N]
 *
 * ⚑ SINGLE-EXAM BY DESIGN. Only the exams in `LLM_STRUCTURABLE_SYLLABUS_EXAMS`
 * (below) may be run through here — a second exam with a hand-authored tree
 * (UPSC) has its own zero-LLM loader, `pnpm ingest:upsc-syllabus`. Running this
 * for such an exam would overwrite that tree in place. See the constant's
 * comment for the two verified failure modes.
 *
 * Flow:
 *   1. Extract text from the official 2026 syllabus PDFs (Hindi + English).
 *      If a PDF is scanned/image-only, route it through Claude vision
 *      (claude-sonnet-5) instead of silently skipping — and FLAG it.
 *   2. For each paper (Prelims GS-I + CSAT, reformed Mains GS-I..GS-VI +
 *      General Hindi + Essay), structure the syllabus subtree with
 *      claude-sonnet-5 under a strict JSON schema, grounded in the PDF text.
 *   3. Where only one language parsed cleanly, generate the other with
 *      claude-haiku-4-5 and mark meta.machine_translated=true for review.
 *   4. Idempotent upsert keyed on (paper_code, path).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_EXAM_CODE,
  TARGET_EXAM_CODES,
  targetExamCodeSchema,
  type TargetExamCode,
} from "@neev/shared";
import { streamText, structuredJson, translate, MODELS } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";
import { buildStructurePaperSystem } from "./prompts.js";
import {
  ROOT,
  readManifest,
  manifestBySection,
  absPath,
  extractPdf,
  pdfDocumentBlock,
  PAPERS,
  assertPaperCodeScoped,
  ensureParsedDir,
  PARSED_DIR,
  parseArgs,
  report,
  type PaperDef,
  type ManifestEntry,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// 0. Which exams may be structured by THIS pipeline at all
// ---------------------------------------------------------------------------
/**
 * ⚑ The exams whose syllabus tree this LLM-structuring pipeline is allowed to
 * build. Adding an exam here is a deliberate, greppable, one-line decision — a
 * future state PCS whose commission publishes a machine-structurable syllabus
 * PDF could legitimately want this path.
 *
 * It is an ALLOW-LIST rather than `=== DEFAULT_EXAM_CODE` precisely so that
 * "which exams may be LLM-structured" and "which exam is the product default"
 * stay separate questions.
 *
 * WHY UPSC IS NOT ON IT — two independently fatal reasons, both verified:
 *
 *  1. `upsertNode` below conflicts on (paper_code, path) — the IDENTICAL key
 *     the hand-authored seed (`ingest/seed/upsc-syllabus-seed.ts`) writes
 *     under. An LLM-invented tree would therefore OVERWRITE the hand-authored,
 *     coverage-gated UPSC tree IN PLACE: `title_i18n`/`description_i18n`/`meta`
 *     replaced wholesale, `meta.source` flipped from
 *     `official_syllabus_hand_authored` to `official_syllabus`, and paths
 *     inserted that the 13-defect coverage gate never approved.
 *  2. `loadLangSource` hardcodes UPPSC's manifest ids
 *     (`uppsc_syllabus_2026_${lang}`, `uppsc_syllabus_drishti_${lang}`). There
 *     is no code path by which it can select `upsc_syllabus_2026_en`, so a
 *     successfully-authored run would structure the UPSC tree FROM UPPSC's
 *     syllabus text.
 *
 * UPSC's real path is `pnpm ingest:upsc-syllabus` — hand-authored, zero-LLM,
 * gated by `verify-coverage.ts`'s 13 defect kinds.
 *
 * This refusal is DELIBERATELY REDUNDANT with the `UNAUTHORED` guard in
 * `lib/exam-config.ts` (`misc.syllabusExpertFraming` etc.), which today makes
 * a `--exam upsc` run die inside `buildStructurePaperSystem`. That guard lives
 * in a different file from the thing it protects, so a future bulk-authoring
 * pass could fill those slots — legitimately, for the mentor/qgen paths — and
 * silently unblock this pipeline without anyone realising. The gate below is
 * local to the danger and cannot be removed by accident.
 */
const LLM_STRUCTURABLE_SYLLABUS_EXAMS: readonly TargetExamCode[] = ["uppsc"];

/** Resolve + validate the run's exam scope. Throws rather than degrading. */
function resolveExamScope(onlyExam: string | null): TargetExamCode {
  const raw = onlyExam ?? DEFAULT_EXAM_CODE;
  const parsed = targetExamCodeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unknown --exam "${raw}". Expected one of: ${TARGET_EXAM_CODES.join(", ")}.`);
  }
  const exam = parsed.data;
  if (!LLM_STRUCTURABLE_SYLLABUS_EXAMS.includes(exam)) {
    throw new Error(
      `ingest:syllabus refuses to run for exam '${exam}'.\n` +
        `  This pipeline LLM-structures a tree from the UPPSC syllabus PDFs and upserts it on\n` +
        `  (paper_code, path) — the same key the hand-authored seed uses — so running it for\n` +
        `  '${exam}' would overwrite that exam's coverage-gated tree with an invented one built\n` +
        `  from the WRONG exam's source text (loadLangSource only knows UPPSC's manifest ids).\n` +
        `  Load '${exam}' with its own hand-authored, coverage-gated seed instead` +
        (exam === "upsc" ? `:\n      pnpm ingest:upsc-syllabus\n` : ` (upsc's is \`pnpm ingest:upsc-syllabus\`).\n`) +
        `  Exams this pipeline may structure: ${LLM_STRUCTURABLE_SYLLABUS_EXAMS.join(", ")}.`,
    );
  }
  return exam;
}

// ---------------------------------------------------------------------------
// 1. Source text per language (with vision fallback for scanned PDFs)
// ---------------------------------------------------------------------------
interface LangSource {
  lang: "hi" | "en";
  text: string;
  viaVision: boolean;
  sourceId: string;
}

async function visionExtract(entry: ManifestEntry): Promise<string> {
  const text = await streamText({
    model: MODELS.sonnet,
    maxTokens: 64000,
    effort: "high",
    purpose: "syllabus_vision_extract",
    retryOnTruncation: true,
    content: [
      await pdfDocumentBlock(absPath(entry)),
      {
        type: "text",
        text:
          "This PDF appears to be scanned/image-only. Transcribe ALL of " +
          "its text verbatim, preserving headings and the outline/section " +
          "structure. Output plain text only — no commentary.",
      },
    ],
  });
  return text.trim();
}

async function loadLangSource(
  entries: ManifestEntry[],
  lang: "hi" | "en",
): Promise<LangSource | null> {
  // Prefer the official 2026 PDF; fall back to the Drishti mirror.
  const preferred = [`uppsc_syllabus_2026_${lang}`, `uppsc_syllabus_drishti_${lang}`];
  let entry: ManifestEntry | undefined;
  for (const id of preferred) {
    entry = entries.find((e) => e.id === id);
    if (entry) break;
  }
  if (!entry) return null;

  const extracted = await extractPdf(absPath(entry));
  if (!extracted.likelyScanned && extracted.text.length > 200) {
    report.ok(
      `${lang}: text-extracted ${entry.id} (${extracted.pageCount}p, ${extracted.text.length} chars)`,
    );
    return { lang, text: extracted.text, viaVision: false, sourceId: entry.id };
  }

  report.warn(
    `${lang}: ${entry.id} looks scanned (${extracted.charsPerPage.toFixed(0)} chars/page) → routing through Claude vision`,
  );
  try {
    const text = await visionExtract(entry);
    report.ok(`${lang}: vision-extracted ${entry.id} (${text.length} chars)`);
    return { lang, text, viaVision: true, sourceId: entry.id };
  } catch (err) {
    // visionExtract can now throw TruncatedResponseError (retryOnTruncation)
    // where it never threw before — degrade to the SAME "only one language
    // parsed" path already used when a manifest entry is simply missing
    // (below), rather than letting one scanned page abort the whole 10-paper
    // run before any DB write happens. The other language, if it parsed,
    // still lets the run complete with this one machine-translated + flagged.
    report.warn(
      `${lang}: vision extraction of ${entry.id} failed (${err instanceof Error ? err.message : String(err)}) — ` +
        `skipping this language for this run; it will be machine-translated from the other if that one succeeded.`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Structure one paper's subtree with claude-sonnet-5
// ---------------------------------------------------------------------------
interface RawNode {
  path: string;
  title_en: string;
  title_hi: string;
  description_en: string;
  description_hi: string;
  order_index: number;
}

const NODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          title_en: { type: "string" },
          title_hi: { type: "string" },
          description_en: { type: "string" },
          description_hi: { type: "string" },
          order_index: { type: "integer" },
        },
        required: [
          "path",
          "title_en",
          "title_hi",
          "description_en",
          "description_hi",
          "order_index",
        ],
      },
    },
  },
  required: ["nodes"],
} as const;

function clip(text: string, max = 45000): string {
  return text.length > max ? text.slice(0, max) : text;
}

// buildStructurePaperSystem lives in ./prompts.ts (imported above), NOT here:
// this module ends in a bare top-level `main().catch(...)` with no argv guard,
// so `pnpm prompts:snapshot` can never import it. Keeping the one
// exam-parameterised system prompt in a side-effect-free sibling module is what
// makes it byte-identity-checkable by the harness instead of by eyeball.

async function structurePaper(
  paper: PaperDef,
  sources: LangSource[],
): Promise<RawNode[]> {
  const en = sources.find((s) => s.lang === "en");
  const hi = sources.find((s) => s.lang === "hi");
  const parts: string[] = [];
  if (en) parts.push(`### OFFICIAL SYLLABUS TEXT (English)\n${clip(en.text)}`);
  if (hi) parts.push(`### OFFICIAL SYLLABUS TEXT (Hindi)\n${clip(hi.text)}`);

  const system = buildStructurePaperSystem(paper.exam);

  const instructions =
    `Build the syllabus tree for this paper:\n` +
    `  paper_code: ${paper.paperCode}\n` +
    `  stage: ${paper.stage}\n` +
    `  title (en): ${paper.title.en}\n` +
    `  title (hi): ${paper.title.hi}\n\n` +
    "Return a flat list of nodes. Each node has:\n" +
    "  - path: a stable slash-separated slug path UNIQUE within this paper, " +
    "e.g. 'history', 'history/ancient-india', 'polity/constitution'. Use " +
    "lowercase ascii kebab-case slugs. The paper root is implicit — do NOT " +
    "emit a node for the paper itself; top-level sections have single-segment " +
    "paths.\n" +
    "  - title_en / title_hi: the section/topic title in BOTH languages.\n" +
    "  - description_en / description_hi: a short gloss in both languages, or " +
    "empty strings if none.\n" +
    "  - order_index: 0-based order among siblings.\n\n" +
    "Aim for 2-3 levels of depth and reasonable topic coverage (roughly " +
    "15-60 nodes depending on the paper). Both language fields must be filled " +
    "when you can; leave a field empty ONLY if you genuinely cannot render it.\n\n" +
    parts.join("\n\n");

  const out = await structuredJson<{ nodes: RawNode[] }>({
    model: MODELS.sonnet,
    system,
    content: instructions,
    schema: NODE_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 32000,
    effort: "high",
  });
  // Guard against a stray leading slash and dedupe paths.
  const seen = new Set<string>();
  return out.nodes
    .map((n) => ({ ...n, path: n.path.replace(/^\/+|\/+$/g, "").trim() }))
    .filter((n) => n.path && !seen.has(n.path) && seen.add(n.path));
}

// ---------------------------------------------------------------------------
// 3. Bilingual fill via claude-haiku-4-5
// ---------------------------------------------------------------------------
interface BuiltNode {
  path: string;
  title_i18n: { hi: string; en: string };
  description_i18n: { hi: string; en: string } | null;
  order_index: number;
  depth: number;
  meta: Record<string, unknown>;
}

async function fillBilingual(
  raw: RawNode,
  forceTranslateInto: "hi" | "en" | null,
  examCode: string,
): Promise<BuiltNode> {
  // The generic domain hint for this exam. `translate()`'s own default was
  // removed in multi-exam slice 2d, so every caller names its exam explicitly.
  const hint = requireAuthored(
    getExamConfig(examCode).misc.translateDomainHint,
    examCode,
    "misc.translateDomainHint",
  );
  const meta: Record<string, unknown> = {};
  let title: { hi: string; en: string } = { hi: raw.title_hi.trim(), en: raw.title_en.trim() };
  let desc: { hi: string; en: string } = {
    hi: raw.description_hi.trim(),
    en: raw.description_en.trim(),
  };

  // If a whole language's source was missing, translate that side wholesale.
  if (forceTranslateInto) {
    const from = forceTranslateInto === "hi" ? "en" : "hi";
    if (!title[forceTranslateInto] && title[from]) {
      title[forceTranslateInto] = await translate(title[from], forceTranslateInto, examCode, hint);
      meta.machine_translated = true;
    }
    if (!desc[forceTranslateInto] && desc[from]) {
      desc[forceTranslateInto] = await translate(desc[from], forceTranslateInto, examCode, hint);
      meta.machine_translated = true;
    }
  } else {
    // Fill any per-node gaps (title must be bilingual).
    if (!title.hi && title.en) {
      title.hi = await translate(title.en, "hi", examCode, hint);
      meta.machine_translated = true;
    } else if (!title.en && title.hi) {
      title.en = await translate(title.hi, "en", examCode, hint);
      meta.machine_translated = true;
    }
  }

  const depth = raw.path.split("/").length; // top-level = 1 (root is depth 0)
  const description_i18n = desc.hi || desc.en ? desc : null;
  return { path: raw.path, title_i18n: title, description_i18n, order_index: raw.order_index, depth, meta };
}

// ---------------------------------------------------------------------------
// 4. Upsert the tree (idempotent on paper_code, path)
// ---------------------------------------------------------------------------
async function upsertNode(
  paper: PaperDef,
  path: string,
  parentId: string | null,
  title_i18n: { hi: string; en: string },
  description_i18n: { hi: string; en: string } | null,
  order_index: number,
  depth: number,
  meta: Record<string, unknown>,
): Promise<string> {
  const row = {
    // The conflict target below is (paper_code, path) and is deliberately
    // UNCHANGED — it is what makes the paper-code invariant (docs/multi-exam.md
    // §0) a hard 23505 rather than a convention. exam_code is stamped as data,
    // never as part of the key: adding it to the key would let two exams share a
    // bare paper code, which ~30 paper_code-only reads elsewhere would then
    // silently mix.
    exam_code: paper.exam,
    exam_stage: paper.stage,
    paper_code: paper.paperCode,
    path,
    parent_id: parentId,
    title_i18n,
    description_i18n,
    order_index,
    depth,
    meta,
  };
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .upsert(row, { onConflict: "paper_code,path" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert ${paper.paperCode}/${path}: ${error.message}`);
  return data.id as string;
}

async function ingestPaper(
  paper: PaperDef,
  sources: LangSource[],
  opts: { dryRun: boolean; limitNodes?: number },
): Promise<{ nodes: number; machineTranslated: number }> {
  // Fail BEFORE any model spend or any write: a mis-scoped paper code would
  // upsert straight onto another exam's tree through (paper_code, path).
  assertPaperCodeScoped(paper.exam, paper.paperCode);
  const raw = await structurePaper(paper, sources);
  const limited = opts.limitNodes ? raw.slice(0, opts.limitNodes) : raw;

  // Which language, if any, was entirely absent from the sources?
  const haveEn = sources.some((s) => s.lang === "en");
  const haveHi = sources.some((s) => s.lang === "hi");
  const forceInto: "hi" | "en" | null = !haveHi ? "hi" : !haveEn ? "en" : null;

  const built: BuiltNode[] = [];
  for (const n of limited) built.push(await fillBilingual(n, forceInto, paper.exam));
  // Deterministic order: shallow first (parents before children), then order_index.
  built.sort((a, b) => a.depth - b.depth || a.order_index - b.order_index || a.path.localeCompare(b.path));

  const machineTranslated = built.filter((b) => b.meta.machine_translated).length;

  if (opts.dryRun) {
    await ensureParsedDir();
    const outPath = join(PARSED_DIR, `syllabus_${paper.paperCode}.json`);
    await writeFile(outPath, JSON.stringify({ paper, nodes: built }, null, 2));
    report.ok(
      `${paper.paperCode}: ${built.length} nodes (${machineTranslated} machine-translated) → ${outPath.replace(ROOT + "/", "")} [dry-run]`,
    );
    return { nodes: built.length, machineTranslated };
  }

  // Paper root node (path '').
  const rootId = await upsertNode(
    paper,
    "",
    null,
    paper.title,
    null,
    0,
    0,
    { source: "official_syllabus" },
  );
  const idByPath = new Map<string, string>([["", rootId]]);

  for (const b of built) {
    const parentKey = b.path.includes("/") ? b.path.split("/").slice(0, -1).join("/") : "";
    const parentId = idByPath.get(parentKey) ?? rootId;
    const id = await upsertNode(
      paper,
      b.path,
      parentId,
      b.title_i18n,
      b.description_i18n,
      b.order_index,
      b.depth,
      b.meta,
    );
    idByPath.set(b.path, id);
  }
  report.ok(
    `${paper.paperCode}: upserted ${built.length + 1} nodes (root + ${built.length}; ${machineTranslated} machine-translated)`,
  );
  return { nodes: built.length + 1, machineTranslated };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Argv SHAPE is now enforced centrally by `parseArgs`'s required spec: unknown
  // flags (the 2026-07-31 collapsed-token incident), bare positionals, valueless
  // value-flags and non-positive-integer numerics are all rejected there, before
  // any billed call or DB write. See docs/OUTSTANDING.md §0d. The domain guards
  // below (resolveExamScope et al.) are NOT argv-shape checks and still apply.
  const args = parseArgs(
    process.argv.slice(2),
    { value: ["exam", "paper"], boolean: ["dry-run"], positiveInt: ["limit-nodes"] },
    "ingest:syllabus",
  );

  const dryRun = !!args["dry-run"];
  const onlyPaper = typeof args.paper === "string" ? args.paper : null;
  const onlyExam = typeof args.exam === "string" ? args.exam : null;
  const limitNodesRaw = typeof args["limit-nodes"] === "string" ? args["limit-nodes"] : null;
  const limitNodes = limitNodesRaw === null ? undefined : Number(limitNodesRaw);

  report.section(`ingest:syllabus${dryRun ? " (dry-run — writes JSON, no DB)" : ""}`);

  // Resolve + gate the exam scope FIRST — before the manifest is read, before any
  // PDF is extracted, and so before even a theoretical scanned-PDF vision call.
  // A refusal must cost nothing and touch nothing.
  //
  // REGRESSION GUARD (kept): this used to default to ALL of PAPERS. Now that
  // PAPERS also holds UPSC papers, a bare `pnpm ingest:syllabus` would try to
  // LLM-structure them and die partway through an otherwise-good UPPSC run. An
  // omitted --exam therefore means the DEFAULT exam only, never all exams.
  const examScope = resolveExamScope(onlyExam);
  if (!onlyExam) {
    report.step(`--exam not given → defaulting to '${DEFAULT_EXAM_CODE}' papers only (never all exams)`);
  }
  let papers = PAPERS.filter((p) => p.exam === examScope);
  if (papers.length === 0) {
    throw new Error(`No papers defined for --exam ${examScope}. Known exams: ${[...new Set(PAPERS.map((p) => p.exam))].join(", ")}`);
  }
  if (onlyPaper) {
    papers = papers.filter((p) => p.paperCode === onlyPaper);
    if (papers.length === 0) {
      throw new Error(
        `Unknown --paper ${onlyPaper} for exam '${examScope}'. Known: ${PAPERS.filter((p) => p.exam === examScope).map((p) => p.paperCode).join(", ")}`,
      );
    }
  }

  const manifest = await readManifest();
  const syllabusEntries = manifestBySection(manifest, "syllabus");
  report.step(`syllabus sources in manifest: ${syllabusEntries.map((e) => e.id).join(", ")}`);

  const en = await loadLangSource(syllabusEntries, "en");
  const hi = await loadLangSource(syllabusEntries, "hi");
  const sources = [en, hi].filter((s): s is LangSource => s !== null);
  if (sources.length === 0) throw new Error("No syllabus source text could be extracted.");
  if (sources.length === 1) {
    report.warn(
      `Only the '${sources[0].lang}' syllabus parsed — the other language will be haiku-translated and flagged machine_translated.`,
    );
  }
  const viaVision = sources.filter((s) => s.viaVision).map((s) => s.lang);
  if (viaVision.length) report.warn(`Vision-extracted languages (flag for review): ${viaVision.join(", ")}`);

  report.section("Structuring papers");
  let totalNodes = 0;
  let totalMt = 0;
  for (const paper of papers) {
    report.step(`→ [${paper.exam}] ${paper.paperCode} (${paper.title.en})`);
    const { nodes, machineTranslated } = await ingestPaper(paper, sources, { dryRun, limitNodes });
    totalNodes += nodes;
    totalMt += machineTranslated;
  }

  report.section("Summary");
  report.ok(`papers: ${papers.length}`);
  report.ok(`nodes total: ${totalNodes}`);
  report.ok(`machine-translated nodes: ${totalMt}`);
  if (viaVision.length) report.warn(`languages needing OCR review: ${viaVision.join(", ")}`);
}

main().catch((err) => {
  console.error("\ningest:syllabus failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
