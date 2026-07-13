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
import { gateMcq, keyProvenanceFor, type BlindStatus, type KeyProvenance } from "./key-provenance.js";
import { raiseKeyDisputeFlag } from "./key-dispute-flag.js";

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
 * Decide a loaded question's review lifecycle + visibility (key-provenance policy,
 * migration 0074). A question is learner-VISIBLE only when is_published AND
 * review_state='approved' (see lib/question-visibility.ts), so "auto-publish" means
 * approved+published.
 *
 * Prelims MCQ — gated by KEY PROVENANCE (gateMcq in key-provenance.ts), uniformly
 * (NOT CSAT-special-cased):
 *  - official_commission + verified key → approved, PUBLISHED on the key ALONE
 *    (blind agreement NOT required). A blind DISAGREEMENT sets keyDispute → a
 *    non-blocking system flag in the Review Queue, but never holds the publish.
 *  - coaching_reproduced / official-without-verified-key / none → blind-resolve
 *    required: verified key AND blind 'ok' → approved+PUBLISHED; a flagged/errored
 *    solve, or an unverified/absent key → needs_review, HELD.
 *  - not publishable (fails bilingual/MCQ gate) → draft, unpublished.
 * Mains descriptive (no key / no blind-solve):
 *  - clean parse + bilingual → approved, PUBLISHED (Tier-B compilation → needs_review).
 *
 * machine_translated Hindi is NOT a blocker. A prior HUMAN decision (approved OR
 * rejected) is never auto-overwritten on a re-load.
 */
function decideReview(
  q: ParsedQuestion,
  publishable: boolean,
  provenance: KeyProvenance,
  priorHumanState: "approved" | "rejected" | undefined,
): { reviewState: ReviewState; isPublished: boolean; keyDispute: boolean } {
  if (priorHumanState === "rejected") return { reviewState: "rejected", isPublished: false, keyDispute: false };
  if (priorHumanState === "approved") return { reviewState: "approved", isPublished: publishable, keyDispute: false };
  if (!publishable) return { reviewState: "draft", isPublished: false, keyDispute: false };

  const meta = q.meta as { answer_key_verified?: boolean; blind_resolve?: { status?: string } };
  const compilation = q.source_kind === "compilation";

  if (q.type === "mcq") {
    return gateMcq({
      provenance,
      keyVerified: meta.answer_key_verified === true,
      blindStatus: meta.blind_resolve?.status as BlindStatus,
      publishable,
      compilation,
    });
  }

  // Mains descriptive: real exam PYQs with no answer-correctness risk — publish on
  // a clean bilingual parse. Node mapping enriches topic-filtering but isn't a
  // gate (pre-reform 2018-22 papers have no topic tree to map into, so requiring
  // it would queue them forever). Tier-B compilation still gets a human eye.
  if (compilation) return { reviewState: "needs_review", isPublished: true, keyDispute: false };
  return { reviewState: "approved", isPublished: true, keyDispute: false };
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
): Promise<{ loaded: number; approved: number; needsReview: number; held: number; failed: number }> {
  const data = JSON.parse(await readFile(file, "utf8")) as ParsedFile;
  let loaded = 0;
  let approved = 0;
  let needsReview = 0;
  let held = 0;
  let failed = 0;

  // Preload which of these external_ids already carry a HUMAN decision
  // (approved or rejected), so a re-load never silently overwrites it: approvals
  // stay visible, rejections stay out of the bank.
  const externalIds = data.questions.map((q) => q.external_id);
  const priorHuman = new Map<string, "approved" | "rejected">();
  for (let i = 0; i < externalIds.length; i += 500) {
    const { data: existing, error } = await supabase()
      .from("questions")
      .select("external_id, review_state")
      .in("external_id", externalIds.slice(i, i + 500))
      .in("review_state", ["approved", "rejected"]);
    if (error) throw new Error(`existing review-state lookup: ${error.message}`);
    for (const r of existing ?? [])
      priorHuman.set(r.external_id as string, r.review_state as "approved" | "rejected");
  }

  for (const q of data.questions) {
    const syllabusNodeId = await resolveSyllabusId(q.syllabus_paper_code, q.syllabus_path);
    // Recompute publishability from the row itself (mirrors the DB gate) rather
    // than trusting the parse-time flag — so a stale/over-optimistic flag can
    // never trip the trigger and abort the whole load.
    const publishable = questionPublishable(q.type, q.stem_i18n, q.options_i18n, q.correct_option_key);
    const provenance = keyProvenanceFor(q.paper_code, q.year);
    const { reviewState, isPublished, keyDispute } = decideReview(
      q,
      publishable,
      provenance,
      priorHuman.get(q.external_id),
    );
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
      key_provenance: provenance,
      is_published: isPublished,
      review_state: reviewState,
      meta: q.meta,
    };
    const { data: upserted, error } = await supabase()
      .from("questions")
      .upsert(row, { onConflict: "external_id" })
      .select("id")
      .single();
    if (error) {
      // Don't abort the batch on one bad row — report and continue.
      report.fail(`${q.external_id}: ${error.message}`);
      failed++;
      continue;
    }
    // Item 3 safety net: an official key we published on, but the blind re-solve
    // disagreed with → non-blocking system flag for a human (never blocks publish).
    if (keyDispute && upserted) {
      const br = (q.meta as { blind_resolve?: { stored_key?: string; chosen_key?: string; confidence?: number } }).blind_resolve;
      await raiseKeyDisputeFlag(supabase(), (upserted as { id: string }).id, {
        official_key: br?.stored_key ?? q.correct_option_key,
        blind_key: br?.chosen_key ?? null,
        confidence: br?.confidence ?? null,
      }).catch((e) => report.warn(`key-dispute flag ${q.external_id}: ${e instanceof Error ? e.message : e}`));
    }
    loaded++;
    if (reviewState === "approved" && isPublished) approved++;
    if (reviewState === "needs_review") needsReview++;
    if (reviewState === "needs_review" && !isPublished) held++;
  }
  return { loaded, approved, needsReview, held, failed };
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
  let totalApproved = 0;
  let totalNeedsReview = 0;
  let totalHeld = 0;
  let totalFailed = 0;
  for (const f of files) {
    const { loaded, approved, needsReview, held, failed } = await loadFile(f);
    report.ok(
      `${basename(f)}: loaded ${loaded} (${approved} auto-published, ${needsReview} needs-review` +
        `${held ? `, ${held} held` : ""}${failed ? `, ${failed} failed` : ""})`,
    );
    totalLoaded += loaded;
    totalApproved += approved;
    totalNeedsReview += needsReview;
    totalHeld += held;
    totalFailed += failed;
  }

  report.section("Summary");
  report.ok(`files: ${files.length}`);
  report.ok(`questions upserted: ${totalLoaded}`);
  report.ok(`auto-published (approved + visible): ${totalApproved}`);
  report.ok(`sent to Review Queue (needs_review): ${totalNeedsReview}`);
  report.ok(`  of which HELD (unpublished pending review): ${totalHeld}`);
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
