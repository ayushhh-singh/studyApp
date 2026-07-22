/**
 * ingest:syllabus — build the full UPPSC syllabus_nodes tree from the real
 * downloaded syllabus PDFs.
 *
 *   pnpm ingest:syllabus [--paper PRE_GS1] [--dry-run] [--limit-nodes N]
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
import { streamText, structuredJson, translate, MODELS } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import {
  ROOT,
  readManifest,
  manifestBySection,
  absPath,
  extractPdf,
  pdfDocumentBlock,
  PAPERS,
  ensureParsedDir,
  PARSED_DIR,
  parseArgs,
  report,
  type PaperDef,
  type ManifestEntry,
} from "./_shared.js";

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
  const text = await visionExtract(entry);
  report.ok(`${lang}: vision-extracted ${entry.id} (${text.length} chars)`);
  return { lang, text, viaVision: true, sourceId: entry.id };
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

async function structurePaper(
  paper: PaperDef,
  sources: LangSource[],
): Promise<RawNode[]> {
  const en = sources.find((s) => s.lang === "en");
  const hi = sources.find((s) => s.lang === "hi");
  const parts: string[] = [];
  if (en) parts.push(`### OFFICIAL SYLLABUS TEXT (English)\n${clip(en.text)}`);
  if (hi) parts.push(`### OFFICIAL SYLLABUS TEXT (Hindi)\n${clip(hi.text)}`);

  const system =
    "You are an expert on the UPPSC (UP PCS) examination and its 2025-reform " +
    "syllabus. You build a clean, hierarchical syllabus tree for ONE paper. " +
    "Ground every node in the provided official syllabus text; use the " +
    "standard UPPSC structure to organise topics into sections and sub-topics. " +
    "Do NOT invent topics that contradict the source.";

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
): Promise<BuiltNode> {
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
      title[forceTranslateInto] = await translate(title[from], forceTranslateInto);
      meta.machine_translated = true;
    }
    if (!desc[forceTranslateInto] && desc[from]) {
      desc[forceTranslateInto] = await translate(desc[from], forceTranslateInto);
      meta.machine_translated = true;
    }
  } else {
    // Fill any per-node gaps (title must be bilingual).
    if (!title.hi && title.en) {
      title.hi = await translate(title.en, "hi");
      meta.machine_translated = true;
    } else if (!title.en && title.hi) {
      title.en = await translate(title.hi, "en");
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
  const raw = await structurePaper(paper, sources);
  const limited = opts.limitNodes ? raw.slice(0, opts.limitNodes) : raw;

  // Which language, if any, was entirely absent from the sources?
  const haveEn = sources.some((s) => s.lang === "en");
  const haveHi = sources.some((s) => s.lang === "hi");
  const forceInto: "hi" | "en" | null = !haveHi ? "hi" : !haveEn ? "en" : null;

  const built: BuiltNode[] = [];
  for (const n of limited) built.push(await fillBilingual(n, forceInto));
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
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args["dry-run"];
  const onlyPaper = typeof args.paper === "string" ? args.paper : null;
  const limitNodes = typeof args["limit-nodes"] === "string" ? Number(args["limit-nodes"]) : undefined;

  report.section(`ingest:syllabus${dryRun ? " (dry-run — writes JSON, no DB)" : ""}`);

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

  const papers = onlyPaper ? PAPERS.filter((p) => p.paperCode === onlyPaper) : PAPERS;
  if (papers.length === 0) throw new Error(`Unknown --paper ${onlyPaper}. Known: ${PAPERS.map((p) => p.paperCode).join(", ")}`);

  report.section("Structuring papers");
  let totalNodes = 0;
  let totalMt = 0;
  for (const paper of papers) {
    report.step(`→ ${paper.paperCode} (${paper.title.en})`);
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
