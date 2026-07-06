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
import { refreshNodeWeightage } from "../lib/weightage.js";
import { listParsed, parseArgs, questionPublishable, report, type ExamCode, type SourceKind } from "./_shared.js";

interface ParsedQuestion {
  external_id: string;
  type: "mcq" | "descriptive";
  stage: "prelims" | "mains";
  exam_code?: ExamCode;
  exam_label_i18n?: { hi: string; en: string };
  source_kind?: SourceKind;
  source_ref?: string;
  out_of_syllabus?: boolean;
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

type ReviewState = "draft" | "needs_review" | "approved" | "rejected";

/**
 * Decide a loaded question's review lifecycle + visibility.
 *  - Incomplete (fails the bilingual/MCQ gate) → draft, unpublished.
 *  - Complete but needs a human eye — machine-translated, Tier-B compilation,
 *    out-of-syllabus, or an answer-key mismatch — → needs_review (Review Queue).
 *    A mismatch is additionally NOT published (flagged, per the source policy).
 *  - Clean official + verified + human-language → approved + published (visible).
 * A row already human-approved in the DB is never auto-downgraded on re-load.
 */
function decideReview(
  q: ParsedQuestion,
  publishable: boolean,
  alreadyApproved: boolean,
): { reviewState: ReviewState; isPublished: boolean } {
  if (alreadyApproved) return { reviewState: "approved", isPublished: publishable };
  const meta = q.meta as { machine_translated?: boolean; answer_key_mismatch?: unknown };
  const mismatch = !!meta.answer_key_mismatch;
  if (!publishable) return { reviewState: "draft", isPublished: false };
  const flagged = !!meta.machine_translated || q.source_kind === "compilation" || !!q.out_of_syllabus || mismatch;
  if (flagged) return { reviewState: "needs_review", isPublished: !mismatch };
  return { reviewState: "approved", isPublished: true };
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

async function loadFile(
  file: string,
): Promise<{ loaded: number; published: number; needsReview: number; failed: number }> {
  const data = JSON.parse(await readFile(file, "utf8")) as ParsedFile;
  let loaded = 0;
  let published = 0;
  let needsReview = 0;
  let failed = 0;

  // Preload which of these external_ids are already human-approved, so a
  // re-load never silently downgrades approved content to needs_review.
  const externalIds = data.questions.map((q) => q.external_id);
  const approved = new Set<string>();
  for (let i = 0; i < externalIds.length; i += 500) {
    const { data: existing, error } = await supabase()
      .from("questions")
      .select("external_id")
      .in("external_id", externalIds.slice(i, i + 500))
      .eq("review_state", "approved");
    if (error) throw new Error(`existing review-state lookup: ${error.message}`);
    for (const r of existing ?? []) approved.add(r.external_id as string);
  }

  for (const q of data.questions) {
    const syllabusNodeId = await resolveSyllabusId(q.syllabus_paper_code, q.syllabus_path);
    // Recompute publishability from the row itself (mirrors the DB gate) rather
    // than trusting the parse-time flag — so a stale/over-optimistic flag can
    // never trip the trigger and abort the whole load.
    const publishable = questionPublishable(q.type, q.stem_i18n, q.options_i18n, q.correct_option_key);
    const { reviewState, isPublished } = decideReview(q, publishable, approved.has(q.external_id));
    const row = {
      external_id: q.external_id,
      type: q.type,
      stage: q.stage,
      exam_code: q.exam_code ?? "uppsc",
      exam_label_i18n: q.exam_label_i18n ?? null,
      source_kind: q.source_kind ?? (q.stage === "mains" ? "official" : "compilation"),
      source_ref: q.source_ref ?? null,
      out_of_syllabus: q.out_of_syllabus ?? false,
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
      review_state: reviewState,
      meta: q.meta,
    };
    const { error } = await supabase()
      .from("questions")
      .upsert(row, { onConflict: "external_id" });
    if (error) {
      // Don't abort the batch on one bad row — report and continue.
      report.fail(`${q.external_id}: ${error.message}`);
      failed++;
      continue;
    }
    loaded++;
    if (isPublished) published++;
    if (reviewState === "needs_review") needsReview++;
  }
  return { loaded, published, needsReview, failed };
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
  let totalNeedsReview = 0;
  let totalFailed = 0;
  for (const f of files) {
    const { loaded, published, needsReview, failed } = await loadFile(f);
    report.ok(
      `${basename(f)}: loaded ${loaded} (${published} published, ${needsReview} needs-review` +
        `${failed ? `, ${failed} failed` : ""})`,
    );
    totalLoaded += loaded;
    totalPublished += published;
    totalNeedsReview += needsReview;
    totalFailed += failed;
  }

  report.section("Summary");
  report.ok(`files: ${files.length}`);
  report.ok(`questions upserted: ${totalLoaded}`);
  report.ok(`published (approved + bilingual complete): ${totalPublished}`);
  report.ok(`sent to Review Queue (needs_review): ${totalNeedsReview}`);
  if (totalFailed) report.warn(`rows failed (see above): ${totalFailed}`);

  // Refresh the cached weightage aggregates so /learn reflects the new load.
  report.step("refreshing weightage aggregates (mv_node_weightage)…");
  await refreshNodeWeightage();
  report.ok("weightage cache refreshed");
}

main().catch((err) => {
  console.error("\ningest:pyq:load failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
