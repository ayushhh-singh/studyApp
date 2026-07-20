/**
 * `pnpm tests:resync-marks [--apply] [--kinds daily_quiz,mock,custom]`
 *
 * Sync each MCQ-scored test's frozen `test_questions.marks` to the LIVE
 * `questions.marks`, and recompute `tests.total_marks` from the result. Fixes
 * tests assembled while a question briefly had null/low marks (the daily-quiz
 * pool defaulted a missing mark to 0, freezing dead 0-mark questions and a wrong
 * total — e.g. the 25.3 / -0.77 quiz). Runtime scoring already prefers live
 * marks (services/attempts.ts), so this is a DATA/display cleanup, not a
 * correctness dependency; it makes the stored snapshot honest again.
 *
 * Only updates a row where the live mark is non-null AND differs from the stored
 * one — never injects a default into stored data, so descriptive/null-mark rows
 * are left untouched. Defaults to daily_quiz/mock/custom; excludes time_attack
 * (marks are a 1-point-per-question game convention, not exam marks) and
 * pyq_full/sectional (their test_questions.marks is intentionally null and their
 * total is already computed from live marks — nothing to fix). Idempotent;
 * dry-run unless --apply.
 */
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { roundMarks } from "../src/lib/marks.js";

const APPLY = process.argv.includes("--apply");
const kindsFlag = process.argv.find((a) => a.startsWith("--kinds="))?.split("=")[1];
const KINDS = (kindsFlag ? kindsFlag.split(",") : ["daily_quiz", "mock", "custom"]).map((s) => s.trim());

async function main(): Promise<void> {
  const db = supabase();
  const tests = (await selectAll<{ id: string; kind: string; slug: string; total_marks: number | null }>(() =>
    db.from("tests").select("id, kind, slug, total_marks").in("kind", KINDS).order("id", { ascending: true }),
  )) as { id: string; kind: string; slug: string; total_marks: number | null }[];
  const testIds = new Set(tests.map((t) => t.id));

  const allTq = await selectAll<{ test_id: string; question_id: string; marks: number | null }>(() =>
    db.from("test_questions").select("test_id, question_id, marks").order("test_id", { ascending: true }),
  );
  const byTest = new Map<string, { question_id: string; marks: number | null }[]>();
  for (const r of allTq) {
    if (!testIds.has(r.test_id)) continue;
    (byTest.get(r.test_id) ?? byTest.set(r.test_id, []).get(r.test_id)!).push(r);
  }

  const liveMarks = new Map<string, number | null>();
  for (const q of await selectAll<{ id: string; marks: number | null }>(() =>
    db.from("questions").select("id, marks").order("id", { ascending: true }),
  ))
    liveMarks.set(q.id, q.marks);

  let testsChanged = 0;
  let rowsChanged = 0;
  let totalsChanged = 0;
  for (const t of tests) {
    const rows = byTest.get(t.id) ?? [];
    if (rows.length === 0) {
      // Defunct test — every question was deleted (cascaded out of
      // test_questions) but a stale non-zero total_marks lingers. Null it so the
      // stored total is honest (there is nothing to score).
      if (t.total_marks != null) {
        console.log(`${t.kind} ${t.slug}: empty (0 questions), total ${t.total_marks} -> null`);
        testsChanged++;
        totalsChanged++;
        if (APPLY) {
          const { error } = await db.from("tests").update({ total_marks: null }).eq("id", t.id);
          if (error) throw new Error(`null total ${t.slug}: ${error.message}`);
        }
      }
      continue;
    }
    const rowUpdates: { question_id: string; from: number | null; to: number }[] = [];
    let newTotal = 0;
    for (const r of rows) {
      const live = liveMarks.get(r.question_id);
      // Prefer live; never inject a default into stored data (leave null-live rows as-is).
      const resolved = live != null ? live : (r.marks ?? 0);
      newTotal += resolved;
      if (live != null && r.marks !== live) rowUpdates.push({ question_id: r.question_id, from: r.marks, to: live });
    }
    newTotal = roundMarks(newTotal);
    const totalChanged =
      t.total_marks == null ? newTotal !== 0 : Math.abs(t.total_marks - newTotal) > 0.001;
    if (rowUpdates.length === 0 && !totalChanged) continue;
    testsChanged++;
    rowsChanged += rowUpdates.length;
    if (totalChanged) totalsChanged++;
    console.log(
      `${t.kind} ${t.slug}: ${rowUpdates.length} row(s) remarked, total ${t.total_marks} -> ${newTotal}` +
        (rowUpdates.length ? `  [${rowUpdates.slice(0, 6).map((u) => `${u.from}->${u.to}`).join(",")}${rowUpdates.length > 6 ? ",…" : ""}]` : ""),
    );
    if (!APPLY) continue;
    for (const u of rowUpdates) {
      const { error } = await db
        .from("test_questions")
        .update({ marks: u.to })
        .eq("test_id", t.id)
        .eq("question_id", u.question_id);
      if (error) throw new Error(`update ${t.slug}/${u.question_id}: ${error.message}`);
    }
    if (totalChanged) {
      const { error } = await db.from("tests").update({ total_marks: newTotal }).eq("id", t.id);
      if (error) throw new Error(`update total ${t.slug}: ${error.message}`);
    }
  }
  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: ${testsChanged} test(s) affected, ${rowsChanged} row(s) remarked, ${totalsChanged} total(s) recomputed.` +
      (APPLY ? "" : "  Re-run with --apply to write."),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
