/**
 * `pnpm ca:backfill`            — DRY RUN: print how many items would be
 *                                 re-classified/enriched + the cost estimate.
 *                                 (Default is plan-only — it never spends.)
 * `pnpm ca:backfill --run`      — actually run, cost-capped by --max-usd or the
 *                                 CA_BACKFILL_MAX_USD env var (required). Uses
 *                                 the Batch API (50% off); resumable.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { planBackfill, runBackfill } from "./backfill.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const doRun = args.run === true || args.run === "true";

  const plan = await planBackfill();

  report.section("ca:backfill — plan");
  report.ok(`items needing backfill (published, not yet re-scored): ${plan.count}`);
  report.ok(`assumed survivors after the gate (~85%): ${plan.assumedSurvivors}`);
  report.ok(`triage cost (all items, Batch API):     $${plan.triageCostUsd.toFixed(4)}`);
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

  report.section(`ca:backfill — RUN (cap $${maxUsd.toFixed(2)})`);
  const res = await runBackfill({ maxUsd, log: (m) => report.step(m) });
  report.section("Summary");
  report.ok(`processed: ${res.processed} (republished: ${res.republished}, draft: ${res.draft}, archived: ${res.archived})`);
  report.ok(`spent: $${res.costUsd.toFixed(4)}  |  remaining: ${res.remaining}`);
  if (res.stoppedForBudget) report.warn("Stopped early to stay under the budget cap — re-run to continue.");
}

main().catch((err) => {
  console.error("\nca:backfill failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
