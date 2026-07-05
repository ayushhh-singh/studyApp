/**
 * CLI entry for the current-affairs pipeline — `pnpm ca:run [--days N]
 * [--max-per-source N] [--max-total N]`. Also what ./scheduler.ts's dev
 * node-cron job calls, and what a production cron host (system cron /
 * platform scheduled job) should invoke directly as a script.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { runPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const days = typeof args.days === "string" ? Number(args.days) : 3;
  const maxPerSource = typeof args["max-per-source"] === "string" ? Number(args["max-per-source"]) : 15;
  const maxTotal = typeof args["max-total"] === "string" ? Number(args["max-total"]) : 40;

  report.section(`ca:run  (days=${days}, max-per-source=${maxPerSource}, max-total=${maxTotal})`);

  const result = await runPipeline({ days, maxPerSource, maxTotal }, (msg) => report.step(msg));

  report.section("Summary");
  report.ok(`processed: ${result.processed} (published: ${result.published}, important: ${result.important})`);
  report.ok(`MCQs generated: ${result.mcqsGenerated}`);
  report.warn(
    `skipped — duplicate: ${result.skippedDuplicate}, too old: ${result.skippedOld}, ` +
      `no date: ${result.skippedNoDate}, irrelevant: ${result.skippedIrrelevant}`,
  );
  if (result.cappedTotal > 0) {
    report.warn(`hit --max-total cap: ${result.cappedTotal} source(s) had remaining items left unprocessed`);
  }
  for (const failure of result.sourceFailures) {
    report.fail(`source "${failure.source}" failed: ${failure.error}`);
  }
}

main().catch((err) => {
  console.error("\nca:run failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
