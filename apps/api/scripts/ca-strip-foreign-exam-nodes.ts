/**
 * `pnpm ca:strip-foreign-nodes [--apply] [--snapshot <path>]`
 *
 * Integrity repair for `current_affairs_items`: remove syllabus node ids (and
 * their `node_significance` entries) belonging to an exam the item is NOT filed
 * under, i.e. whose node's `syllabus_nodes.exam_code` is absent from the row's
 * own `exam_codes`.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ROWS EXIST — and ⚑ THE PRODUCER IS NOT THIS BRANCH
 * ---------------------------------------------------------------------------
 * The UPSC syllabus tree was seeded 2026-07-30 (202 nodes). From that moment,
 * CA triage ran ONE UPPSC-framed call per item against a candidate pool that
 * ALSO contained those UPSC nodes — so 64 genuinely-UPPSC items came back
 * classified onto 48 distinct `UPSC_*` nodes (78 references). They are UPPSC
 * content in every other respect: `gs_papers` carries the UPPSC-shaped taxonomy,
 * `exam_codes` is `["uppsc"]`, their embeddings are stamped `uppsc`, and 62 of
 * the 64 also carry real UPPSC nodes. Live UPPSC readers saw foreign syllabus
 * chips deep-linking into UPSC content.
 *
 * It is tempting to read that as "pre-fan-out code, therefore already fixed by
 * ca/exam-fanout.ts". IT IS NOT. Forensics on 2026-08-01 (ledger payload shapes,
 * `llm_calls.exam_code`, and the shown-candidate pool recorded per batch) pinned
 * the producer to `.github/workflows/ca-run.yml` — a `schedule:` workflow, which
 * GitHub runs from the DEFAULT branch, with `actions/checkout@v4` and no `ref:`.
 * That is `main`, which at the time sat at `dd4bdeb` (2026-07-28) where
 * `loadSyllabusCandidates()` takes NO arguments and applies NO exam filter, so
 * the pool is every depth-1..2 node of every exam. It writes the same cloud
 * Supabase project through the repo's Actions secrets, on that workflow's
 * six-hourly UTC schedule. (Spelling the cron expression out here is not worth
 * it: it contains a star-slash, which would close this very comment.)
 *
 * Two consequences that matter to whoever reads this next:
 *  - `exams.upsc.is_live` was NEVER flipped (its `updated_at` has not moved
 *    since 2026-07-31T07:03:17Z, and `exams` carries an unconditional
 *    `set_updated_at` trigger). Contamination never needed a flip.
 *  - THE PRODUCER IS STILL LIVE until `main` is advanced or that schedule is
 *    disabled. Re-running this tool is not a fix, only a repair.
 *
 * ⚑ STRIP, NOT WIDEN — and this is a decision, not a default. Adding `upsc` to
 * `exam_codes` would surface UPPSC-voiced, UPPSC-taxonomy content in an exam
 * whose `is_live` is false, and would disagree with the `uppsc` embeddings
 * already written for these items. Deliberately mapping a second exam ONTO the
 * CA corpus is a different operation with its own tool and its own re-triage:
 * `ca:widen-exam` (M48). This one only ever removes a mapping the row's own
 * `exam_codes` does not justify.
 *
 * ---------------------------------------------------------------------------
 * ⚑ READ THIS BEFORE RUNNING IT AGAIN
 * ---------------------------------------------------------------------------
 * The selection predicate trusts `exam_codes`. That is sound only because the
 * write paths now keep `exam_codes` in step with `syllabus_node_ids` by
 * construction (ca/exam-fanout.ts's `withExamScope`). It was NOT sound before
 * 2026-08-01: ca/pipeline.ts's published/draft insert omitted `exam_codes`
 * entirely, so every user-visible row silently took the column default
 * `array['uppsc']`. Run against rows written by that path, this tool would read
 * a default as a fact and strip the CORRECT nodes.
 *
 * So: if a future run reports rows, do not just `--apply`. Confirm first that
 * their `exam_codes` reflects real triage rather than a default.
 *
 * For the 64 rows this was applied to on 2026-08-01 that check was done, and the
 * honest answer is that `exam_codes` WAS the column default — `main@dd4bdeb`'s
 * insert never writes the column at all. Stripping was still right, and the
 * reason is not the column: that build has no notion of a second exam anywhere,
 * its triage system prompt opens "You are a UPPSC (UP state civil services) exam
 * strategist", and every one of these items' embeddings is stamped `uppsc`. So
 * the default and the truth coincided. Verify that coincidence again next time
 * rather than inheriting it — a run under `ca:run --exam <other>` would produce
 * rows where they DIVERGE, and stripping those would delete the correct nodes.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 *  - NEVER deletes a row. It only ever narrows two columns.
 *  - Writes ONE statement per explicitly captured id (`.eq("id", <id>)`). No
 *    `.overlaps()`/`.in()`/predicate update ever reaches `.update()` — the
 *    selection scan and the write are separate steps, per CLAUDE.md's cleanup
 *    rule and the 2026-07-23 deletion incident.
 *  - Re-reads each row immediately before writing and SKIPS it if either column
 *    has drifted from the scan snapshot (`ca:run` is 6-hourly and can touch a
 *    row mid-run).
 *  - The payload type forbids every other column via `?: never`, with a runtime
 *    assertion behind it — the same two-guard device as `ca/widen-exam.ts`.
 *    `exam_codes`, `status`, `is_published` and all content columns are
 *    unreachable from here, by the type AND at runtime.
 *  - Dry-run unless `--apply`, and `--apply` writes a full pre-image snapshot of
 *    every row it will touch first, so any row can be restored by explicit id.
 *  - Idempotent: a second run finds nothing to do.
 */
import { writeFileSync } from "node:fs";
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { parseArgs } from "../src/ingest/_shared.js";

const args = parseArgs(
  process.argv.slice(2),
  { boolean: ["apply"], value: ["snapshot"] },
  "ca:strip-foreign-nodes",
);
const APPLY = !!args.apply;
const SNAPSHOT = typeof args.snapshot === "string" ? args.snapshot : null;

// ---------------------------------------------------------------------------
// The write payload — structurally narrowed to the two columns this may touch
// ---------------------------------------------------------------------------

const STRIP_UPDATE_COLUMNS = ["syllabus_node_ids", "node_significance"] as const;

/**
 * Every other column of `current_affairs_items` this tool must never write.
 * `exam_codes` heads the list deliberately: widening it is a different
 * operation with a different tool (see the header), and a repair script that
 * could reach it is exactly the hazard worth designing out.
 */
type ForbiddenStripColumn =
  | "exam_codes"
  | "status"
  | "is_published"
  | "date"
  | "category"
  | "gs_papers"
  | "is_up_specific"
  | "prelims_relevance"
  | "mains_relevance"
  | "title_i18n"
  | "summary_i18n"
  | "detail_i18n"
  | "prelims_facts"
  | "mains_brief"
  | "possible_questions"
  | "mcq_question_ids"
  | "content_hash"
  | "source_id"
  | "source_urls"
  | "created_at"
  | "updated_at";

/** Naming any forbidden column here is a COMPILE error, not a convention. */
export type StripUpdate = {
  syllabus_node_ids: string[];
  node_significance?: Record<string, unknown> | null;
} & { [K in ForbiddenStripColumn]?: never };

/**
 * Runtime backstop. The type is erased at runtime, so a payload built by
 * spreading an untyped object (or an `as StripUpdate` cast) would otherwise
 * reach `.update()` unchecked. This writes to live production content; one of
 * the two guards being redundant is the point.
 */
export function assertStripPayload(payload: Record<string, unknown>): void {
  const allowed = new Set<string>(STRIP_UPDATE_COLUMNS);
  const illegal = Object.keys(payload).filter((k) => !allowed.has(k));
  if (illegal.length > 0) {
    throw new Error(
      `ca:strip-foreign-nodes refuses to write ${illegal.map((k) => `"${k}"`).join(", ")}: this tool may ` +
        `only narrow ${STRIP_UPDATE_COLUMNS.join(" + ")}. Widening exam_codes is ca:widen-exam's job (M48).`,
    );
  }
  if (!Array.isArray(payload.syllabus_node_ids)) {
    throw new Error("ca:strip-foreign-nodes payload must always carry syllabus_node_ids — a partial payload is never intended.");
  }
}

// ---------------------------------------------------------------------------
// Pure selection
// ---------------------------------------------------------------------------

interface CaScopeRow {
  id: string;
  status: string;
  syllabus_node_ids: string[] | null;
  node_significance: Record<string, unknown> | null;
  exam_codes: string[] | null;
}

export interface StripPlan {
  id: string;
  status: string;
  before: { nodeIds: string[]; significance: Record<string, unknown> | null };
  after: { nodeIds: string[]; significance: Record<string, unknown> | null };
  /** The removed ids, with the exam each actually belongs to. */
  removed: { id: string; examCode: string }[];
  /** node_significance keys removed (a subset of `removed`, plus any orphan key). */
  removedSignificanceKeys: string[];
}

/**
 * Decide what one row loses. Pure — no DB, no clock — so the rule is testable
 * and the write step below is a mechanical application of it.
 *
 * A node id that resolves to NO tree is left alone: it is a dangling reference,
 * a different defect, and silently folding it into an exam-scope repair would
 * hide it. (There are none today; this is stated so a future run cannot quietly
 * change meaning.)
 */
export function planStrip(row: CaScopeRow, nodeExam: ReadonlyMap<string, string>): StripPlan | null {
  const examCodes = new Set(row.exam_codes ?? []);
  const nodeIds = row.syllabus_node_ids ?? [];

  const removed: { id: string; examCode: string }[] = [];
  const keptIds: string[] = [];
  for (const id of nodeIds) {
    const owner = nodeExam.get(id);
    if (owner !== undefined && !examCodes.has(owner)) removed.push({ id, examCode: owner });
    else keptIds.push(id);
  }
  if (removed.length === 0) return null;

  const removedSet = new Set(removed.map((r) => r.id));
  const sig = row.node_significance;
  let after: Record<string, unknown> | null = sig;
  const removedSignificanceKeys: string[] = [];
  if (sig) {
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(sig)) {
      if (removedSet.has(k)) removedSignificanceKeys.push(k);
      else kept[k] = v;
    }
    // Empty ⇒ null, matching how the pipeline writes "no significance" (the
    // archive path never writes the column at all, so null is its resting shape).
    after = Object.keys(kept).length > 0 ? kept : null;
  }

  return {
    id: row.id,
    status: row.status,
    before: { nodeIds, significance: sig },
    after: { nodeIds: keptIds, significance: after },
    removed,
    removedSignificanceKeys,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function main(): Promise<void> {
  // Paged: `syllabus_nodes` is ~500 rows and `current_affairs_items` ~3.5k —
  // both past PostgREST's 1000-row cap, where an unranged select silently
  // truncates instead of erroring.
  const nodes = await selectAll<{ id: string; exam_code: string }>(() =>
    supabase().from("syllabus_nodes").select("id, exam_code").order("id"),
  );
  const nodeExam = new Map(nodes.map((n) => [n.id, n.exam_code]));

  const rows = await selectAll<CaScopeRow>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, status, syllabus_node_ids, node_significance, exam_codes")
      .order("id"),
  );

  const plans = rows.map((r) => planStrip(r, nodeExam)).filter((p): p is StripPlan => p !== null);

  const byExam = new Map<string, number>();
  const byStatus = new Map<string, number>();
  let refs = 0;
  let sigKeys = 0;
  let emptyAfter = 0;
  let sigNullAfter = 0;
  for (const p of plans) {
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    for (const r of p.removed) byExam.set(r.examCode, (byExam.get(r.examCode) ?? 0) + 1);
    refs += p.removed.length;
    sigKeys += p.removedSignificanceKeys.length;
    if (p.after.nodeIds.length === 0) emptyAfter++;
    if (p.before.significance !== null && p.after.significance === null) sigNullAfter++;
  }

  console.log(`scanned ${rows.length} current_affairs_items against ${nodes.length} syllabus nodes`);
  console.log(`rows carrying a foreign-exam node: ${plans.length} — by status ${JSON.stringify(Object.fromEntries(byStatus))}`);
  console.log(`  node references to remove: ${refs} — by owning exam ${JSON.stringify(Object.fromEntries(byExam))}`);
  console.log(`  node_significance keys to remove: ${sigKeys}`);
  console.log(`  rows left with an EMPTY syllabus_node_ids: ${emptyAfter}`);
  console.log(`  rows whose node_significance becomes null: ${sigNullAfter}`);

  if (plans.length === 0) {
    console.log("nothing to do.");
    return;
  }

  if (!APPLY) {
    for (const p of plans.slice(0, 10)) {
      console.log(
        `  [dry-run] ${p.id} (${p.status}) ${p.before.nodeIds.length} -> ${p.after.nodeIds.length} nodes; ` +
          `drop ${p.removed.map((r) => `${r.id.slice(0, 8)}@${r.examCode}`).join(", ")}`,
      );
    }
    if (plans.length > 10) console.log(`  … and ${plans.length - 10} more`);
    console.log("\nDRY RUN — nothing written. Re-run with --apply (and read this file's header first).");
    return;
  }

  if (SNAPSHOT) {
    const ids = plans.map((p) => p.id);
    const pre: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 40) {
      const { data, error } = await supabase().from("current_affairs_items").select("*").in("id", ids.slice(i, i + 40));
      if (error) throw new Error(`snapshot read failed: ${error.message}`);
      pre.push(...(data ?? []));
    }
    if (pre.length !== ids.length) throw new Error(`snapshot incomplete (${pre.length}/${ids.length}) — refusing to write`);
    writeFileSync(SNAPSHOT, JSON.stringify({ capturedAt: new Date().toISOString(), plans, rows: pre }, null, 2));
    console.log(`pre-image snapshot of all ${pre.length} rows -> ${SNAPSHOT}`);
  }

  let updated = 0;
  let skippedDrift = 0;
  let failed = 0;
  for (const p of plans) {
    // Re-read THIS row, by its explicit id, immediately before writing it.
    const { data: fresh, error: readErr } = await supabase()
      .from("current_affairs_items")
      .select("syllabus_node_ids, node_significance")
      .eq("id", p.id)
      .maybeSingle();
    if (readErr || !fresh) {
      console.log(`  SKIP ${p.id}: re-read failed (${readErr?.message ?? "row not found"})`);
      failed++;
      continue;
    }
    const freshIds = (fresh.syllabus_node_ids as string[] | null) ?? [];
    const freshSig = (fresh.node_significance as Record<string, unknown> | null) ?? null;
    if (
      !sameIds(freshIds, p.before.nodeIds) ||
      JSON.stringify(freshSig) !== JSON.stringify(p.before.significance)
    ) {
      console.log(`  SKIP ${p.id}: row changed since the scan — leaving it for a re-run`);
      skippedDrift++;
      continue;
    }

    const payload: StripUpdate = {
      syllabus_node_ids: p.after.nodeIds,
      ...(p.removedSignificanceKeys.length > 0 ? { node_significance: p.after.significance } : {}),
    };
    assertStripPayload(payload as Record<string, unknown>);

    const { error: writeErr } = await supabase().from("current_affairs_items").update(payload).eq("id", p.id);
    if (writeErr) {
      console.log(`  FAIL ${p.id}: ${writeErr.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  console.log(`\napplied: ${updated} updated, ${skippedDrift} skipped (drift), ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("ca-strip-foreign-exam-nodes.ts")) {
  await main();
}
