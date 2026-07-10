/**
 * `pnpm ca:deepdive [--month YYYY-MM]`        — DRY RUN: rank this month's top
 *                                               issues + print a cost estimate.
 *                                               (Default is plan-only — never spends.)
 * `pnpm ca:deepdive --month YYYY-MM --run`    — actually generate the five deep
 *                                               dives via the Batch API and insert
 *                                               them as needs_review (clears any
 *                                               previous unpublished drafts for
 *                                               that month first).
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { currentIstMonth } from "../lib/month.js";
import { planDeepDives, runDeepDives } from "./deepdive.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const month = typeof args.month === "string" ? args.month : currentIstMonth();
  const doRun = args.run === true || args.run === "true";

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    report.fail(`--month must be YYYY-MM, got "${month}"`);
    process.exit(1);
  }

  const plan = await planDeepDives(month);
  report.section(`ca:deepdive — plan for ${month}`);
  report.ok(`candidate issues ranked: ${plan.count}`);
  for (const [i, title] of plan.titles.entries()) report.step(`  ${i + 1}. ${title}`);
  report.ok(`ESTIMATED COST (Batch API): $${plan.estimatedCostUsd.toFixed(4)}`);

  if (plan.count === 0) {
    report.warn(`No published mains-life items with mains_relevance >= 2 for ${month} yet — nothing to generate.`);
    return;
  }

  if (!doRun) {
    report.section("Dry run — nothing spent");
    report.step(`Re-run with \`--month ${month} --run\` to generate + insert (needs_review, awaiting Review Queue approval).`);
    return;
  }

  report.section(`ca:deepdive — RUN for ${month}`);
  const res = await runDeepDives(month, (m) => report.step(m));
  report.section("Summary");
  report.ok(`generated: ${res.generated}/${res.planned} (failed: ${res.failed})`);
  report.ok(`spent: $${res.costUsd.toFixed(4)}`);
  if (res.generated > 0) report.step("Awaiting review in the admin Review Queue's Magazine tab before they appear in the Mains Analysis edition.");
}

main().catch((err) => {
  console.error("\nca:deepdive failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
