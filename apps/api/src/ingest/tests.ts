/**
 * ingest:tests — assemble tests from published questions already in the DB.
 *
 *   pnpm ingest:tests
 *
 * Builds two kinds:
 *   1. pyq_full  — one test per (paper_code, year) full PYQ paper, e.g.
 *      "UPPSC Prelims GS-I 2024", with the real marking scheme stored on the
 *      test row (UPPSC Prelims negative marking -0.33; descriptive papers carry
 *      no negative marking).
 *   2. sectional — one test per top-level syllabus node, from published MCQs
 *      classified under that section's subtree.
 *
 * Idempotent: tests keyed on slug; a test's membership is rebuilt each run.
 */
import { supabase } from "../lib/supabase.js";
import { paperByCode, report } from "./_shared.js";

interface QRow {
  id: string;
  type: "mcq" | "descriptive";
  stage: "prelims" | "mains";
  paper_code: string;
  year: number | null;
  marks: number | null;
  syllabus_node_id: string | null;
}

const PRELIMS_NEGATIVE = -0.33; // UPPSC Prelims: one-third negative marking.

function durationFor(paperCode: string, stage: string): number {
  if (stage === "mains") return 180; // 3 hours
  return paperCode === "PRE_CSAT" ? 150 : 120; // CSAT 2.5h, GS-I 2h
}

async function fetchPublished(): Promise<QRow[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, type, stage, paper_code, year, marks, syllabus_node_id")
    .eq("is_published", true);
  if (error) throw new Error(`fetch questions: ${error.message}`);
  return (data ?? []) as QRow[];
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
    const totalMarks = qs.reduce((s, q) => s + (q.marks ?? 0), 0) || null;
    const slug = `pyq:${paperCode}:${year}`;
    const title = {
      en: `UPPSC ${paper.title.en} — ${year}`,
      hi: `यूपीपीएससी ${paper.title.hi} — ${year}`,
    };
    const meta = {
      source: "pyq",
      year,
      marking_scheme: isPrelims
        ? { type: "uppsc_prelims", negative_marking: PRELIMS_NEGATIVE, note: "one-third (1/3) negative marking" }
        : { type: "descriptive", negative_marking: 0 },
    };
    const testId = await upsertTest({
      slug,
      title_i18n: title,
      kind: "pyq_full",
      paper_code: paperCode,
      duration_minutes: durationFor(paperCode, stage),
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
  const bySection = new Map<string, { paperCode: string; top: string; titleEn: string; ids: string[] }>();
  for (const q of published) {
    if (q.type !== "mcq" || !q.syllabus_node_id) continue;
    const info = topByNode.get(q.syllabus_node_id);
    if (!info) continue;
    const key = `${info.paperCode}::${info.top}`;
    if (!bySection.has(key)) bySection.set(key, { ...info, ids: [] });
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
      meta: { source: "auto_sectional", section_path: s.top, marking_scheme: { type: "uppsc_prelims", negative_marking: PRELIMS_NEGATIVE } },
    });
    await setMembership(testId, s.ids.sort());
    report.ok(`${slug}: ${s.ids.length} MCQs`);
    sectionalCount++;
  }

  report.section("Summary");
  report.ok(`full PYQ paper tests: ${fullCount}`);
  report.ok(`sectional tests: ${sectionalCount}`);
}

main().catch((err) => {
  console.error("\ningest:tests failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
