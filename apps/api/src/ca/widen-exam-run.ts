/**
 * `pnpm ca:widen-exam --exam <code>`
 *      — DRY RUN (the default): how many published items the exam does not yet
 *        claim, and what triaging them would cost. Makes NO model call and NO
 *        embedding call, so it spends nothing and is safe to run freely.
 *
 * `pnpm ca:widen-exam --exam <code> --apply --max-usd <n>`
 *      — the write pass. Runs THAT EXAM'S OWN triage over those items (Message
 *        Batches API, 50% off) and, for each item clearing that exam's relevance
 *        gate, UNIONs the exam code + newly mapped nodes onto the row's stored
 *        `exam_codes` / `syllabus_node_ids`. Nothing else is written, ever.
 *
 * `--limit <n>`  — triage only the n most recent eligible items (sampling).
 * `--dry-run`    — explicit form of the default. Contradicts `--apply`.
 *
 * ⚑ WHY THIS EXISTS RATHER THAN `ca:backfill --exam <code>`: that tool RE-SCORES
 * AND REWRITES. It reaches only `prelims_relevance IS NULL` (107 of 2,104
 * published), REPLACES `exam_codes` / `syllabus_node_ids` with this run's scope
 * alone, and rewrites the row's content columns — archiving anything the target
 * exam gates out, which pulls a good live item out of the LIVE exam's feed. See
 * `./widen-exam.ts`'s header and `docs/OUTSTANDING.md` §8c M48.
 *
 * ⚑ DRY RUN IS THE DEFAULT BECAUSE THIS WRITES LIVE PRODUCTION CONTENT. The
 * Supabase project is shared between dev and prod, so the write pass must be an
 * explicit, separately-authorised act — `--apply` plus a budget cap, never a
 * bare invocation.
 *
 * AFTERWARDS: `exam_codes` is what `caEmbeddingExamCode` reads, so a widened
 * corpus needs `pnpm ca:embed --all` before the new exam's mentor grounding can
 * see any of it. That is a separate, separately-authorised step.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { resolveTargetExams } from "../lib/exams.js";
import { estimateTriageCostPerItem, planWiden, runWiden } from "./widen-exam.js";

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    // `exam` is a `value` flag so a valueless `--exam` is REJECTED rather than
    // collapsing to boolean `true` — which `resolveTargetExams` would read as
    // "no override" and silently widen by the LIVE exam instead of the intended
    // one. That is the §0d shape, on a tool that writes production content.
    { boolean: ["apply", "dry-run"], value: ["exam"], positiveInt: ["limit"], positiveNumber: ["max-usd"] },
    "ca:widen-exam",
  );

  const apply = args.apply === true;
  const dryRunFlag = args["dry-run"] === true;
  if (apply && dryRunFlag) {
    report.fail("--apply and --dry-run contradict each other. Pass exactly one (or neither, which means dry run).");
    process.exit(1);
  }

  // REQUIRED, unlike every other `--exam` in the repo. Elsewhere omitting it
  // means "the live set", which is a sensible default for a BUILD. Here the flag
  // names the exam being ADDED to rows that already belong to another exam, so
  // there is no defensible default — and defaulting to the live set would make a
  // bare invocation widen the corpus by the exam that already owns it.
  if (typeof args.exam !== "string") {
    report.fail("--exam <code> is required: this tool widens the corpus BY a named exam. There is no default.");
    process.exit(1);
  }

  // Validated against the `exams` registry BEFORE any read or spend.
  // `getExamConfig` does NOT throw on an unknown code — it warns and falls back
  // to the default exam — so `--exam upcs` would otherwise quietly widen the
  // corpus by UPPSC under a typo'd label.
  const { examCodes } = await resolveTargetExams({
    examArg: args.exam,
    cli: "ca:widen-exam",
    action: "widening the current-affairs corpus for",
    log: (m) => report.warn(m),
  });
  const examCode = examCodes[0];

  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined;
  const plan = await planWiden(examCode, limit);

  report.section(`ca:widen-exam — plan (${examCode})`);
  report.ok(`published current-affairs items:            ${plan.publishedTotal}`);
  report.ok(`already carry "${examCode}" (skipped, no cost): ${plan.alreadyWidened}`);
  report.ok(`would be triaged for "${examCode}":             ${plan.targeted}`);
  if (plan.deferredByLimit > 0) report.step(`(${plan.deferredByLimit} more eligible, deferred by --limit ${limit})`);
  report.ok(
    `estimated cost (Batch API, 1 triage call/item @ ~$${estimateTriageCostPerItem().toFixed(5)}): ` +
      `$${plan.estimatedCostUsd.toFixed(4)}`,
  );
  report.step("Writes exam_codes + syllabus_node_ids ONLY, as stored ∪ new. No content column, no status, no delete.");
  report.step("An item below this exam's relevance gate is left completely untouched (never archived).");

  if (!apply) {
    report.section("Dry run — nothing spent, nothing written");
    report.step("No model call and no embedding call was made; this projection is read-only.");
    report.step(`Re-run with --apply --max-usd <cap> to execute (cap must be ≥ the estimate above).`);
    return;
  }

  const maxUsd = typeof args["max-usd"] === "string" ? Number(args["max-usd"]) : undefined;
  if (!maxUsd) {
    report.fail("--apply requires an explicit budget ceiling: pass --max-usd <n>.");
    process.exit(1);
  }
  // HARD CEILING: refuse to START if the projection already exceeds the cap,
  // rather than spending up to it and stopping mid-corpus. A partial widening is
  // recoverable (re-run), but an operator who mis-sized the cap should find that
  // out before the first batch is billed, not after.
  if (plan.estimatedCostUsd > maxUsd) {
    report.fail(
      `Projected $${plan.estimatedCostUsd.toFixed(4)} exceeds --max-usd $${maxUsd.toFixed(2)}. ` +
        `Raise the cap, or narrow the run with --limit <n>.`,
    );
    process.exit(1);
  }

  report.section(`ca:widen-exam — APPLY (${examCode}, cap $${maxUsd.toFixed(2)})`);
  const res = await runWiden({ examCode, maxUsd, limit, log: (m) => report.step(m) });

  report.section("Summary");
  report.ok(`widened (exam_codes ∪, syllabus_node_ids ∪): ${res.widened}`);
  report.ok(`below "${examCode}" relevance gate — untouched: ${res.belowGate}`);
  report.ok(`already widened at write time — no-op:        ${res.noopAtWrite}`);
  report.ok(`already carried the code at selection:        ${res.skippedAlreadyWidened}`);
  if (res.unusable > 0) report.warn(`unusable triage (untouched, retryable): ${res.unusable}`);
  report.ok(`spent: $${res.costUsd.toFixed(4)}  |  not yet processed: ${res.remaining}`);
  if (res.stoppedForBudget) report.warn("Stopped early to stay under the budget cap — re-run to continue.");
  if (res.widened > 0) report.step("Next: `pnpm ca:embed --all` so the new exam's grounding can see the widened rows.");
}

main().catch((err) => {
  console.error("\nca:widen-exam failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
