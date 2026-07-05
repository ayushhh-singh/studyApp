/**
 * ingest:pyq:load — load reviewed parsed/pyq_<id>.json into the questions
 * table. Separate from ingest:pyq so a human reviews the JSON first.
 *
 *   pnpm ingest:pyq:load --id uppsc_prelims_2024_gs1   (one file)
 *   pnpm ingest:pyq:load --all                          (every parsed/pyq_*.json)
 *
 * - source='pyq'.
 * - is_published=true ONLY when both languages are present (bilingual publish
 *   gate); the DB trigger enforces the same rule, so a partial row loads as a
 *   draft (is_published=false) rather than failing.
 * - Idempotent upsert keyed on external_id.
 * - Resolves syllabus_path → syllabus_node_id via (paper_code, path).
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { supabase } from "../lib/supabase.js";
import { listParsed, parseArgs, report } from "./_shared.js";

interface ParsedQuestion {
  external_id: string;
  type: "mcq" | "descriptive";
  stage: "prelims" | "mains";
  paper_code: string;
  year: number;
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

interface ParsedFile {
  source: { manifest_id: string };
  questions: ParsedQuestion[];
}

/** path -> syllabus_node_id, cached per paper_code. */
const syllabusCache = new Map<string, Map<string, string>>();

async function resolveSyllabusId(paperCode: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (!syllabusCache.has(paperCode)) {
    const { data, error } = await supabase()
      .from("syllabus_nodes")
      .select("id, path")
      .eq("paper_code", paperCode);
    if (error) throw new Error(`syllabus lookup ${paperCode}: ${error.message}`);
    const m = new Map<string, string>();
    for (const n of data ?? []) m.set(n.path as string, n.id as string);
    syllabusCache.set(paperCode, m);
  }
  return syllabusCache.get(paperCode)!.get(path) ?? null;
}

async function loadFile(file: string): Promise<{ loaded: number; published: number }> {
  const data = JSON.parse(await readFile(file, "utf8")) as ParsedFile;
  let loaded = 0;
  let published = 0;

  for (const q of data.questions) {
    const syllabusNodeId = await resolveSyllabusId(q.syllabus_paper_code, q.syllabus_path);
    const isPublished = q.is_bilingual_complete;
    const row = {
      external_id: q.external_id,
      type: q.type,
      stage: q.stage,
      paper_code: q.paper_code,
      syllabus_node_id: syllabusNodeId,
      year: q.year,
      source: "pyq",
      stem_i18n: q.stem_i18n,
      options_i18n: q.options_i18n,
      correct_option_key: q.correct_option_key,
      explanation_i18n: q.explanation_i18n,
      difficulty: q.difficulty,
      marks: q.marks,
      word_limit: q.word_limit,
      is_published: isPublished,
      meta: q.meta,
    };
    const { error } = await supabase()
      .from("questions")
      .upsert(row, { onConflict: "external_id" });
    if (error) throw new Error(`upsert ${q.external_id}: ${error.message}`);
    loaded++;
    if (isPublished) published++;
  }
  return { loaded, published };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  report.section("ingest:pyq:load");

  let files: string[];
  if (args.all) {
    files = await listParsed("pyq_");
  } else if (typeof args.id === "string") {
    files = await listParsed(`pyq_${args.id}`);
  } else {
    throw new Error("Provide --id <manifest_id> or --all.");
  }
  if (files.length === 0) throw new Error("No parsed/pyq_*.json files found. Run ingest:pyq first.");

  let totalLoaded = 0;
  let totalPublished = 0;
  for (const f of files) {
    const { loaded, published } = await loadFile(f);
    report.ok(`${basename(f)}: loaded ${loaded} (${published} published)`);
    totalLoaded += loaded;
    totalPublished += published;
  }

  report.section("Summary");
  report.ok(`files: ${files.length}`);
  report.ok(`questions upserted: ${totalLoaded}`);
  report.ok(`published (bilingual complete): ${totalPublished}`);
}

main().catch((err) => {
  console.error("\ningest:pyq:load failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
