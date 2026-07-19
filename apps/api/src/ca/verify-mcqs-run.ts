/**
 * `pnpm ca:verify-mcqs`            — DRY RUN: print how many pending CA MCQs
 *                                    would be confidence-checked + the cost
 *                                    estimate. (Default is plan-only — never spends.)
 * `pnpm ca:verify-mcqs --run`      — actually run, cost-capped by --max-usd or
 *                                    the CA_VERIFY_MCQS_MAX_USD env var
 *                                    (required). Uses the Batch API (50% off);
 *                                    resumable.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { planVerifyMcqs, runVerifyMcqs } from "./verify-mcqs.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const doRun = args.run === true || args.run === "true";

  const plan = await planVerifyMcqs();

  report.section("ca:verify-mcqs — plan");
  report.ok(`pending CA MCQs (needs_review, no confidence check yet): ${plan.count}`);
  report.ok(`ESTIMATED TOTAL (haiku, Batch API):                      $${plan.costUsd.toFixed(4)}`);
  report.step("(estimate uses a conservative token-size guess × haiku Batch-API rates; actual bills at real usage)");

  if (!doRun) {
    report.section("Dry run — nothing spent");
    report.step("Re-run with `--run --max-usd <cap>` (or set CA_VERIFY_MCQS_MAX_USD) to execute.");
    return;
  }

  const capArg = typeof args["max-usd"] === "string" ? Number(args["max-usd"]) : undefined;
  const capEnv = process.env.CA_VERIFY_MCQS_MAX_USD ? Number(process.env.CA_VERIFY_MCQS_MAX_USD) : undefined;
  const maxUsd = capArg ?? capEnv;
  if (!maxUsd || Number.isNaN(maxUsd) || maxUsd <= 0) {
    report.fail("--run requires a positive budget cap: pass --max-usd <n> or set CA_VERIFY_MCQS_MAX_USD.");
    process.exit(1);
  }

  report.section(`ca:verify-mcqs — RUN (cap $${maxUsd.toFixed(2)})`);
  const res = await runVerifyMcqs({ maxUsd, log: (m) => report.step(m) });
  report.section("Summary");
  report.ok(`processed: ${res.processed} (agreed: ${res.agreed}, disagreed: ${res.disagreed}, no facts found: ${res.noFactsFound})`);
  report.ok(`spent: $${res.costUsd.toFixed(4)}  |  remaining: ${res.remaining}`);
  if (res.stoppedForBudget) report.warn("Stopped early to stay under the budget cap — re-run to continue.");
  report.step("Approve high-confidence CA MCQs in bulk from the Review Queue's Current Affairs tab once this has run.");
}

main().catch((err) => {
  console.error("\nca:verify-mcqs failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
