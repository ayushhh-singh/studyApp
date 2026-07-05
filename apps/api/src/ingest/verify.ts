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
  const { data: qs, error: qErr } = await db
    .from("questions")
    .select("type, stage, paper_code, year, source, is_published, publish_gate_ok, meta");
  if (qErr) throw new Error(qErr.message);
  report.section("Questions per year / paper");
  const qKey = new Map<string, number>();
  let totalQ = 0;
  let bilingual = 0;
  let mcq = 0;
  let akVerified = 0;
  let published = 0;
  for (const q of qs ?? []) {
    totalQ++;
    if (q.publish_gate_ok) bilingual++;
    if (q.is_published) published++;
    if (q.type === "mcq") {
      mcq++;
      if ((q.meta as { answer_key_verified?: boolean })?.answer_key_verified) akVerified++;
    }
    const key = `${q.year ?? "----"} ${q.paper_code}`;
    qKey.set(key, (qKey.get(key) ?? 0) + 1);
  }
  if (qKey.size === 0) report.warn("none");
  for (const key of [...qKey.keys()].sort()) {
    console.log(`  ${key.padEnd(18)} ${String(qKey.get(key)).padStart(4)}`);
  }
  report.section("Question coverage");
  console.log(`  total questions        ${String(totalQ).padStart(6)}`);
  console.log(`  published              ${String(published).padStart(6)}`);
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
  const { data: embs, error: eErr } = await db
    .from("embeddings")
    .select("source_type, source_id, locale");
  if (eErr) throw new Error(eErr.message);
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
