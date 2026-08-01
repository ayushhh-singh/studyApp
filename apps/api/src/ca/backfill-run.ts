/**
 * `pnpm ca:backfill`            — DRY RUN: print how many items would be
 *                                 re-classified/enriched + the cost estimate.
 *                                 (Default is plan-only — it never spends.)
 * `pnpm ca:backfill --run`      — actually run, cost-capped by --max-usd or the
 *                                 CA_BACKFILL_MAX_USD env var (required). Uses
 *                                 the Batch API (50% off); resumable.
 * `pnpm ca:backfill --exam <c>` — target ONE exam instead of the live set. May
 *                                 name a not-yet-live exam, so its corpus can be
 *                                 built before launch without flipping
 *                                 `exams.is_live` (which would also make it
 *                                 user-selectable — docs/OUTSTANDING.md U7).
 *
 * ⚑ READ `./backfill.ts`'s HEADER BEFORE USING `--exam` ON A SHARED CORPUS.
 * This tool RE-SCORES AND REWRITES; it does not ADD a second exam's mapping to
 * an existing row. Narrowing the scope DROPS every other exam's `exam_codes` and
 * `syllabus_node_ids` from every row it processes, and rewrites that row's
 * content columns. It also only ever sees items whose `prelims_relevance` is
 * still NULL, so it cannot reach an already-scored corpus at all.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { resolveTargetExams } from "../lib/exams.js";
import { planBackfill, runBackfill } from "./backfill.js";

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    // `exam` is a `value` flag, so a valueless `--exam` is rejected by the
    // parser rather than collapsing to boolean `true` and silently falling back
    // to the live set — which on a REWRITING tool is a data-loss shape.
    { boolean: ["run"], value: ["exam"], positiveNumber: ["max-usd"] },
    "ca:backfill",
  );
  // `run` is declared boolean, so the parser yields only `true` or `undefined`
  // — the old `|| args.run === "true"` branch is now dead. `--run true` is
  // rejected loudly as a stray positional, which is the safe outcome.
  const doRun = args.run === true;
  // Resolved BEFORE the plan, so an unknown code dies before any DB read and
  // long before any spend.
  const { examCodes, overridden } = await resolveTargetExams({
    examArg: args.exam,
    cli: "ca:backfill",
    action: "backfilling",
    log: (m) => report.warn(m),
  });

  const plan = await planBackfill(examCodes);

  report.section("ca:backfill — plan");
  report.ok(`target exams: ${examCodes.join(", ")}${overridden ? "  [--exam override]" : "  [live set]"}`);
  report.ok(`items needing backfill (published, not yet re-scored): ${plan.count}`);
  report.ok(`assumed survivors after the gate (~85%): ${plan.assumedSurvivors}`);
  report.ok(
    `triage cost (all items × ${examCodes.length} exam(s), Batch API): $${plan.triageCostUsd.toFixed(4)}`,
  );
  report.ok(`enrich cost (survivors, Batch API):     $${plan.enrichCostUsd.toFixed(4)}`);
  report.ok(`ESTIMATED TOTAL:                        $${plan.totalCostUsd.toFixed(4)}`);
  report.step("(estimate uses measured triage/enrich token sizes × haiku Batch-API rates; actual bills at real usage)");

  if (!doRun) {
    report.section("Dry run — nothing spent");
    report.step("Re-run with `--run --max-usd <cap>` (or set CA_BACKFILL_MAX_USD) to execute.");
    return;
  }

  const capArg = typeof args["max-usd"] === "string" ? Number(args["max-usd"]) : undefined;
  const capEnv = process.env.CA_BACKFILL_MAX_USD ? Number(process.env.CA_BACKFILL_MAX_USD) : undefined;
  const maxUsd = capArg ?? capEnv;
  if (!maxUsd || Number.isNaN(maxUsd) || maxUsd <= 0) {
    report.fail("--run requires a positive budget cap: pass --max-usd <n> or set CA_BACKFILL_MAX_USD.");
    process.exit(1);
  }

  report.section(`ca:backfill — RUN (cap $${maxUsd.toFixed(2)}, exams ${examCodes.join(",")})`);
  const res = await runBackfill({ maxUsd, examCodes, log: (m) => report.step(m) });
  report.section("Summary");
  report.ok(`processed: ${res.processed} (republished: ${res.republished}, draft: ${res.draft}, archived: ${res.archived})`);
  report.ok(`spent: $${res.costUsd.toFixed(4)}  |  remaining: ${res.remaining}`);
  if (res.stoppedForBudget) report.warn("Stopped early to stay under the budget cap — re-run to continue.");
}

main().catch((err) => {
  console.error("\nca:backfill failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
