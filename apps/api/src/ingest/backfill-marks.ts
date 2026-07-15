/**
 * ingest:backfill-marks — repair prelims MCQ rows that were loaded BEFORE pyq-load
 * stamped `questions.marks` (the pre-2026-07 loads left marks=null on every prelims
 * PYQ). A null on BOTH questions.marks AND test_questions.marks silently scores an
 * attempt 0/0 (see services/attempts.ts grading: `question_marks[qid] ?? 0`), so
 * pyq_full / sectional / custom / daily-quiz tests over these papers graded to 0.
 *
 *   pnpm ingest:backfill-marks                 (dry-run, both prelims papers)
 *   pnpm ingest:backfill-marks --paper PRE_GS1
 *   pnpm ingest:backfill-marks --apply         (write questions.marks where NULL)
 *   pnpm ingest:backfill-marks --apply --normalize  (also CORRECT non-null wrong values)
 *
 * Sets `questions.marks` = the real UPPSC per-question value (PRELIMS_MARKING:
 * GS-I 1.33, CSAT 2). By default it touches ONLY rows where marks is NULL — never
 * overwriting a non-null value (the demo-seed's "never clobber real data" rule).
 * With `--normalize` it ALSO corrects rows whose marks is a WRONG non-null value:
 * a prelims MCQ has exactly ONE legitimate per-question mark, so a stray value (e.g.
 * an early-ingest `1` on a GS-I question that should be 1.33) is an error, not real
 * data — correcting it is safe and keeps a paper's per-question marks uniform.
 * Existing mock test_questions already bake their own marks at build time, so they're
 * untouched; this only repairs the questions-table source the other test kinds read
 * through. Idempotent: a second run finds 0 rows to fix.
 */
import { supabase } from "../lib/supabase.js";
import { PRELIMS_MARKING } from "../lib/exam-papers.js";
import { parseArgs, report } from "./_shared.js";

const PAPERS = Object.keys(PRELIMS_MARKING);

interface Row {
  id: string;
  marks: number | null;
  type: string;
  is_published: boolean;
  review_state: string;
}

async function fetchRows(paper: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, marks, type, is_published, review_state")
      .eq("paper_code", paper)
      .eq("type", "mcq")
      .range(from, from + 999);
    if (error) throw new Error(`fetch ${paper}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function updateIds(ids: string[], target: number, onlyNull: boolean): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    let q = supabase().from("questions").update({ marks: target }).in("id", ids.slice(i, i + 200));
    // Defensive against a concurrent write between fetch and update: for the NULL pass
    // only touch rows that are still NULL; the normalize pass targets specific ids only.
    if (onlyNull) q = q.is("marks", null);
    const { error } = await q;
    if (error) throw new Error(`update: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apply = !!args.apply;
  const normalize = !!args.normalize;
  const papers = typeof args.paper === "string" ? [args.paper] : PAPERS;
  report.section(
    `ingest:backfill-marks — stamp prelims MCQ marks${normalize ? " + normalize wrong values" : " (NULL only)"} ${apply ? "(APPLY)" : "(dry-run)"}`,
  );

  let grandNull = 0;
  let grandWrong = 0;
  for (const paper of papers) {
    const target = PRELIMS_MARKING[paper]?.marksPerQuestion;
    if (target == null) {
      report.warn(`${paper}: not a known prelims MCQ paper — skipped`);
      continue;
    }
    const rows = await fetchRows(paper);
    const nullRows = rows.filter((r) => r.marks == null);
    const wrongRows = rows.filter((r) => r.marks != null && r.marks !== target);
    const nullVisible = nullRows.filter((r) => r.is_published && r.review_state === "approved").length;
    const wrongVisible = wrongRows.filter((r) => r.is_published && r.review_state === "approved").length;
    const wrongVals = [...new Set(wrongRows.map((r) => r.marks))].sort();
    report.section(`${paper}: ${rows.length} MCQ · target ${target}/Q`);
    report.step(`marks NULL: ${nullRows.length} (${nullVisible} visible) → set to ${target}`);
    if (wrongRows.length) {
      const verb = normalize ? `→ CORRECT to ${target}` : "(left untouched — pass --normalize to correct)";
      report.warn(`wrong non-null marks [${wrongVals.join(", ")}]: ${wrongRows.length} (${wrongVisible} visible) ${verb}`);
    }

    if (apply) {
      if (nullRows.length) await updateIds(nullRows.map((r) => r.id), target, true);
      if (normalize && wrongRows.length) await updateIds(wrongRows.map((r) => r.id), target, false);
      report.ok(`${paper}: set ${nullRows.length} null${normalize ? ` + corrected ${wrongRows.length} wrong` : ""}`);
    }
    grandNull += nullRows.length;
    grandWrong += wrongRows.length;
  }

  report.section("Summary");
  report.ok(`NULL rows ${apply ? "set" : "to set"}: ${grandNull}`);
  report.ok(`wrong-value rows ${normalize ? (apply ? "corrected" : "to correct") : "found (not touched; --normalize to fix)"}: ${grandWrong}`);
  if (!apply && (grandNull || grandWrong)) report.step("re-run with --apply (add --normalize to also correct wrong values).");
}

main().catch((err) => {
  console.error("\ningest:backfill-marks failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
