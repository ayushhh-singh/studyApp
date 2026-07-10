/**
 * ingest:verify — print the state of ingested content in Supabase.
 *
 *   pnpm ingest:verify
 *
 * Reports:
 *   - syllabus nodes per paper
 *   - questions per year/paper
 *   - % bilingual-complete (publish gate)
 *   - % answer-key-verified (MCQ)
 *   - embedding coverage per source type
 */
import { supabase } from "../lib/supabase.js";
import { report } from "./_shared.js";

function pct(n: number, d: number): string {
  return d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

/**
 * Fetch every row of a table, paging past PostgREST's 1000-row cap — the bank
 * now exceeds 1000 questions, so a single `.select()` would silently undercount.
 */
async function fetchAllRows<T = Record<string, unknown>>(table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase()
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const db = supabase();
  report.section("ingest:verify");

  // --- Syllabus nodes per paper ---
  const { data: nodes, error: nErr } = await db
    .from("syllabus_nodes")
    .select("paper_code, exam_stage, meta");
  if (nErr) throw new Error(nErr.message);
  const byPaper = new Map<string, { total: number; mt: number; stage: string }>();
  for (const n of nodes ?? []) {
    const cur = byPaper.get(n.paper_code) ?? { total: 0, mt: 0, stage: n.exam_stage };
    cur.total++;
    if ((n.meta as { machine_translated?: boolean })?.machine_translated) cur.mt++;
    byPaper.set(n.paper_code, cur);
  }
  report.section("Syllabus nodes per paper");
  if (byPaper.size === 0) report.warn("none");
  for (const code of [...byPaper.keys()].sort()) {
    const v = byPaper.get(code)!;
    console.log(
      `  ${code.padEnd(12)} ${v.stage.padEnd(8)} ${String(v.total).padStart(4)} nodes` +
        (v.mt ? `  (${v.mt} machine-translated)` : ""),
    );
  }
  console.log(`  ${"TOTAL".padEnd(12)} ${" ".padEnd(8)} ${String(nodes?.length ?? 0).padStart(4)} nodes`);

  // --- Questions per year/paper + bilingual / answer-key coverage ---
  const qs = await fetchAllRows<{
    type: string;
    stage: string;
    exam_code: string | null;
    source_kind: string | null;
    out_of_syllabus: boolean | null;
    paper_code: string;
    year: number | null;
    source: string;
    is_published: boolean;
    review_state: string | null;
    publish_gate_ok: boolean;
    meta: unknown;
  }>(
    "questions",
    "type, stage, exam_code, source_kind, out_of_syllabus, paper_code, year, source, is_published, review_state, publish_gate_ok, meta",
  );
  report.section("Questions per year / paper");
  const qKey = new Map<string, number>();
  let totalQ = 0;
  let bilingual = 0;
  let mcq = 0;
  let akVerified = 0;
  let published = 0;
  let approvedVisible = 0; // review_state='approved' AND is_published — the true learner-visible ("auto-published") set
  let needsReview = 0;
  let held = 0; // needs_review AND NOT published — fully withheld pending review
  let outOfSyllabus = 0;
  // exam_code AND source_kind breakdown — the provenance audit trail.
  const examSource = new Map<string, { total: number; published: number }>();
  const byExam = new Map<string, number>();
  for (const q of qs ?? []) {
    totalQ++;
    if (q.publish_gate_ok) bilingual++;
    if (q.is_published) published++;
    if (q.review_state === "approved" && q.is_published) approvedVisible++;
    if (q.review_state === "needs_review") needsReview++;
    if (q.review_state === "needs_review" && !q.is_published) held++;
    if (q.out_of_syllabus) outOfSyllabus++;
    if (q.type === "mcq") {
      mcq++;
      if ((q.meta as { answer_key_verified?: boolean })?.answer_key_verified) akVerified++;
    }
    const key = `${q.year ?? "----"} ${q.paper_code}`;
    qKey.set(key, (qKey.get(key) ?? 0) + 1);
    const es = `${q.exam_code ?? "?"} · ${q.source_kind ?? "?"}`;
    const bucket = examSource.get(es) ?? { total: 0, published: 0 };
    bucket.total++;
    if (q.is_published) bucket.published++;
    examSource.set(es, bucket);
    byExam.set(q.exam_code ?? "?", (byExam.get(q.exam_code ?? "?") ?? 0) + 1);
  }
  if (qKey.size === 0) report.warn("none");
  for (const key of [...qKey.keys()].sort()) {
    console.log(`  ${key.padEnd(18)} ${String(qKey.get(key)).padStart(4)}`);
  }

  report.section("Questions by exam_code × source_kind  (provenance audit)");
  console.log(`  ${"exam · source_kind".padEnd(28)} ${"total".padStart(6)} ${"published".padStart(10)}`);
  console.log("  " + "-".repeat(46));
  for (const key of [...examSource.keys()].sort()) {
    const v = examSource.get(key)!;
    console.log(`  ${key.padEnd(28)} ${String(v.total).padStart(6)} ${String(v.published).padStart(10)}`);
  }
  console.log("  " + "-".repeat(46));
  console.log(`  by exam: ${[...byExam.entries()].sort().map(([e, n]) => `${e}=${n}`).join("  ")}`);

  report.section("Question coverage");
  console.log(`  total questions        ${String(totalQ).padStart(6)}`);
  console.log(`  auto-published (visible) ${String(approvedVisible).padStart(4)}  (approved + is_published)  ${pct(approvedVisible, totalQ)}`);
  console.log(`  is_published flag set   ${String(published).padStart(5)}  (incl. needs_review pending approval)`);
  console.log(`  needs_review (queued)  ${String(needsReview).padStart(6)}  of which held (unpublished): ${held}`);
  console.log(`  out-of-syllabus        ${String(outOfSyllabus).padStart(6)}`);
  console.log(`  bilingual-complete     ${pct(bilingual, totalQ).padStart(6)}  (${bilingual}/${totalQ})`);
  console.log(`  MCQ answer-key-verified ${pct(akVerified, mcq).padStart(5)}  (${akVerified}/${mcq} MCQ)`);

  // --- Tests ---
  const { data: tests, error: tErr } = await db.from("tests").select("kind, is_published");
  if (tErr) throw new Error(tErr.message);
  report.section("Tests");
  const tByKind = new Map<string, number>();
  for (const t of tests ?? []) tByKind.set(t.kind, (tByKind.get(t.kind) ?? 0) + 1);
  if (tByKind.size === 0) report.warn("none");
  for (const k of [...tByKind.keys()].sort()) console.log(`  ${k.padEnd(14)} ${String(tByKind.get(k)).padStart(4)}`);

  // --- Embedding coverage ---
  const embs = await fetchAllRows<{ source_type: string; source_id: string; locale: string }>(
    "embeddings",
    "source_type, source_id, locale",
  );
  report.section("Embedding coverage");
  const embByType = new Map<string, Set<string>>();
  const chunkByType = new Map<string, number>();
  for (const e of embs ?? []) {
    if (!embByType.has(e.source_type)) embByType.set(e.source_type, new Set());
    embByType.get(e.source_type)!.add(e.source_id);
    chunkByType.set(e.source_type, (chunkByType.get(e.source_type) ?? 0) + 1);
  }
  // Denominators: syllabus_nodes count, questions count.
  const denom: Record<string, number> = {
    syllabus: nodes?.length ?? 0,
    question: totalQ,
  };
  if ((embs ?? []).length === 0) report.warn("none");
  for (const type of [...embByType.keys()].sort()) {
    const sources = embByType.get(type)!.size;
    const chunks = chunkByType.get(type) ?? 0;
    const d = denom[type];
    console.log(
      `  ${type.padEnd(16)} ${String(sources).padStart(5)} sources embedded` +
        (d !== undefined ? `  (${pct(sources, d)} of ${d})` : "") +
        `  ${chunks} chunks`,
    );
  }

  console.log();
}

main().catch((err) => {
  console.error("\ningest:verify failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
