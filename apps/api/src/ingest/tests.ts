/**
 * ingest:tests — assemble tests from published questions already in the DB.
 *
 *   pnpm ingest:tests
 *
 * Builds two kinds:
 *   1. pyq_full  — one test per (paper_code, year) full PYQ paper, e.g.
 *      "UPPSC Prelims GS-I 2024", with the real marking scheme stored on the
 *      test row (verified per-paper negative marking; descriptive papers
 *      carry no negative marking).
 *   2. sectional — one test per top-level syllabus node, from published MCQs
 *      classified under that section's subtree.
 *
 * Both kinds are titled/labeled "UPPSC" and use UPPSC's own marking scheme,
 * so BOTH are restricted to exam_code='uppsc' questions only — this app also
 * ingests UPSC Civil Services and UPSSSC PET questions onto the same
 * paper_code (PRE_GS1) for weightage-overlap analytics (see _shared.ts's
 * classifyPyqId), and those exams have their own, different, unverified
 * marking schemes. A year with zero genuine UPPSC-sourced questions simply
 * gets no pyq_full test rather than a paper mislabeled "UPPSC" that's
 * actually 100% a different exam.
 *
 * Idempotent: tests keyed on slug; a test's membership is rebuilt each run.
 */
import { supabase } from "../lib/supabase.js";
import { UPPSC_EXAM_CODE } from "../lib/question-visibility.js";
import { paperByCode, report } from "./_shared.js";

interface QRow {
  id: string;
  type: "mcq" | "descriptive";
  stage: "prelims" | "mains";
  paper_code: string;
  year: number | null;
  marks: number | null;
  syllabus_node_id: string | null;
  exam_code: string | null;
}

// Real UPPSC Prelims marking, verified via web search against multiple
// independent sources (cross-checked, not from memory): GS-I is 150
// questions summing to 200 marks (1.33/correct, -0.33/wrong — one-third);
// CSAT is 100 questions summing to 200 marks (2/correct, -0.66/wrong — also
// one-third, just of a whole-number question mark). Both papers run 2 hours.
const PRELIMS_MARKING: Record<string, { marksPerQuestion: number; negativeMarking: number }> = {
  PRE_GS1: { marksPerQuestion: 1.33, negativeMarking: -0.33 },
  PRE_CSAT: { marksPerQuestion: 2, negativeMarking: -0.66 },
};

function durationFor(stage: string): number {
  return stage === "mains" ? 180 : 120; // Mains: 3h. Both Prelims papers: 2h.
}

async function fetchPublished(): Promise<QRow[]> {
  // Paginate past PostgREST's 1000-row cap — the published bank now exceeds 1000,
  // so a single .select() silently truncated later papers (e.g. 2025 mains showed
  // 1-4 of 20 questions). Also require review_state='approved': a test must only
  // contain LEARNER-VISIBLE questions (is_published alone includes needs_review).
  const out: QRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, type, stage, paper_code, year, marks, syllabus_node_id, exam_code")
      .eq("is_published", true)
      .eq("review_state", "approved")
      // See the module doc comment — pyq_full/sectional are UPPSC-labeled and
      // UPPSC-marked, so only genuinely UPPSC-sourced questions may enter them.
      .eq("exam_code", UPPSC_EXAM_CODE)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch questions: ${error.message}`);
    const rows = (data ?? []) as QRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** node_id -> top-level path slug (for sectional grouping). */
async function topLevelByNode(): Promise<Map<string, { paperCode: string; top: string; titleEn: string }>> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, path, title_i18n");
  if (error) throw new Error(`fetch syllabus: ${error.message}`);
  const byId = new Map<string, { paper_code: string; path: string }>();
  const titleByPaperTop = new Map<string, string>();
  for (const n of data ?? []) {
    byId.set(n.id as string, { paper_code: n.paper_code as string, path: n.path as string });
    const path = n.path as string;
    if (path && !path.includes("/")) {
      titleByPaperTop.set(`${n.paper_code}::${path}`, (n.title_i18n as { en?: string })?.en ?? path);
    }
  }
  const out = new Map<string, { paperCode: string; top: string; titleEn: string }>();
  for (const [id, { paper_code, path }] of byId) {
    if (!path) continue;
    const top = path.split("/")[0];
    out.set(id, {
      paperCode: paper_code,
      top,
      titleEn: titleByPaperTop.get(`${paper_code}::${top}`) ?? top,
    });
  }
  return out;
}

async function upsertTest(row: {
  slug: string;
  title_i18n: { hi: string; en: string };
  kind: string;
  paper_code: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  is_published: boolean;
  meta: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase()
    .from("tests")
    .upsert(row, { onConflict: "slug" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert test ${row.slug}: ${error.message}`);
  return data.id as string;
}

async function setMembership(testId: string, questionIds: string[]): Promise<void> {
  // Rebuild membership so re-runs converge.
  const del = await supabase().from("test_questions").delete().eq("test_id", testId);
  if (del.error) throw new Error(`clear members ${testId}: ${del.error.message}`);
  if (questionIds.length === 0) return;
  const rows = questionIds.map((qid, i) => ({ test_id: testId, question_id: qid, order_index: i }));
  const ins = await supabase().from("test_questions").insert(rows);
  if (ins.error) throw new Error(`insert members ${testId}: ${ins.error.message}`);
}

async function main(): Promise<void> {
  report.section("ingest:tests");
  const published = await fetchPublished();
  report.step(`published questions available: ${published.length}`);
  if (published.length === 0) {
    report.warn("no published questions yet — load PYQs first (ingest:pyq:load). Nothing to assemble.");
    return;
  }

  // --- 1. Full PYQ papers ---
  report.section("Full PYQ papers");
  const byPaperYear = new Map<string, QRow[]>();
  for (const q of published) {
    if (q.year == null) continue;
    const key = `${q.paper_code}::${q.year}`;
    (byPaperYear.get(key) ?? byPaperYear.set(key, []).get(key)!).push(q);
  }
  let fullCount = 0;
  for (const key of [...byPaperYear.keys()].sort()) {
    const [paperCode, yearStr] = key.split("::");
    const year = Number(yearStr);
    const qs = byPaperYear.get(key)!;
    const paper = paperByCode(paperCode);
    if (!paper) continue;
    const stage = qs[0].stage;
    const isPrelims = stage === "prelims";
    const prelimsMarking = PRELIMS_MARKING[paperCode];
    const totalMarks = qs.reduce((s, q) => s + (q.marks ?? prelimsMarking?.marksPerQuestion ?? 0), 0) || null;
    const slug = `pyq:${paperCode}:${year}`;
    const title = {
      en: `UPPSC ${paper.title.en} — ${year}`,
      hi: `यूपीपीएससी ${paper.title.hi} — ${year}`,
    };
    const meta = {
      source: "pyq",
      year,
      marking_scheme:
        isPrelims && prelimsMarking
          ? { type: "uppsc_prelims", negative_marking: prelimsMarking.negativeMarking, note: "one-third (1/3) negative marking" }
          : { type: "descriptive", negative_marking: 0 },
    };
    const testId = await upsertTest({
      slug,
      title_i18n: title,
      kind: "pyq_full",
      paper_code: paperCode,
      duration_minutes: durationFor(stage),
      total_marks: totalMarks,
      is_published: true,
      meta,
    });
    await setMembership(
      testId,
      qs.sort((a, b) => a.id.localeCompare(b.id)).map((q) => q.id),
    );
    report.ok(`${slug}: ${qs.length} questions`);
    fullCount++;
  }

  // --- 2. Sectional tests (published MCQs per top-level syllabus node) ---
  report.section("Sectional tests (per top-level syllabus node)");
  const topByNode = await topLevelByNode();
  const bySection = new Map<
    string,
    { paperCode: string; top: string; titleEn: string; type: "mcq" | "descriptive"; ids: string[] }
  >();
  for (const q of published) {
    if (!q.syllabus_node_id) continue;
    const info = topByNode.get(q.syllabus_node_id);
    if (!info) continue;
    // Keyed by type too (defensive, not currently load-bearing — every
    // paper_code today is either all-MCQ (Prelims) or all-descriptive
    // (Mains)): the player can only run one kind, so a section must never
    // mix them if that ever changes.
    const key = `${info.paperCode}::${info.top}::${q.type}`;
    if (!bySection.has(key)) bySection.set(key, { ...info, type: q.type, ids: [] });
    bySection.get(key)!.ids.push(q.id);
  }
  let sectionalCount = 0;
  for (const key of [...bySection.keys()].sort()) {
    const s = bySection.get(key)!;
    const paper = paperByCode(s.paperCode);
    if (!paper) continue;
    const slug = `sectional:${s.paperCode}:${s.top}`;
    const testId = await upsertTest({
      slug,
      title_i18n: {
        en: `${paper.title.en} — ${s.titleEn} (Sectional)`,
        hi: `${paper.title.hi} — ${s.titleEn} (अनुभागीय)`,
      },
      kind: "sectional",
      paper_code: s.paperCode,
      duration_minutes: null,
      total_marks: null,
      is_published: true,
      meta: {
        source: "auto_sectional",
        section_path: s.top,
        marking_scheme:
          s.type === "mcq"
            ? { type: "uppsc_prelims", negative_marking: PRELIMS_MARKING[s.paperCode]?.negativeMarking ?? -0.33 }
            : { type: "descriptive", negative_marking: 0 },
      },
    });
    await setMembership(testId, s.ids.sort());
    report.ok(`${slug}: ${s.ids.length} ${s.type === "mcq" ? "MCQs" : "questions"}`);
    sectionalCount++;
  }

  // Clean up stale EMPTY tests: a paper that lost all its published questions
  // (e.g. keys stripped / questions held) leaves a 0-question test that renders
  // broken in the UI. Delete any auto-built pyq_full/sectional test with no members.
  const { data: allTests } = await supabase().from("tests").select("id, slug, kind").in("kind", ["pyq_full", "sectional"]);
  const { data: memberRows } = await supabase().from("test_questions").select("test_id");
  const hasMembers = new Set((memberRows ?? []).map((m) => m.test_id as string));
  const emptyIds = (allTests ?? []).filter((t) => !hasMembers.has(t.id as string)).map((t) => t.id as string);
  if (emptyIds.length) {
    await supabase().from("test_questions").delete().in("test_id", emptyIds);
    await supabase().from("tests").delete().in("id", emptyIds);
    report.ok(`removed ${emptyIds.length} empty (0-question) tests`);
  }

  report.section("Summary");
  report.ok(`full PYQ paper tests: ${fullCount}`);
  report.ok(`sectional tests: ${sectionalCount}`);
}

main().catch((err) => {
  console.error("\ningest:tests failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
