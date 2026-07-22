/**
 * CLI entry for the current-affairs pipeline — `pnpm ca:run [--days N]
 * [--max-per-source N] [--max-total N] [--mode batch|sync] [--wait MINUTES]`.
 * Also what ./scheduler.ts's dev node-cron job calls, and what a production
 * cron host (system cron / platform scheduled job) should invoke directly as a
 * script.
 *
 * TWO-PHASE BY DEFAULT (--mode batch): each invocation first COLLECTS any
 * previously-submitted triage batch that has since ended — running the full
 * gate/enrich/persist/quiz downstream for its items — then SUBMITS a fresh
 * batch for this run's new feed items and exits WITHOUT waiting for it. Triage
 * therefore costs half (Message Batches API) and sits off the critical path,
 * at the cost of an item going live on a LATER run (~one 6h tick).
 *   --wait N   after submitting, poll for up to N minutes and collect the new
 *              batch in this same run — for running it by hand; cron leaves it 0.
 *   --mode sync  the original blocking one-triage-call-per-item path, full
 *              price, everything live immediately.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { runPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const days = typeof args.days === "string" ? Number(args.days) : 3;
  const maxPerSource = typeof args["max-per-source"] === "string" ? Number(args["max-per-source"]) : 15;
  const maxTotal = typeof args["max-total"] === "string" ? Number(args["max-total"]) : 40;
  const mode = args.mode === "sync" ? "sync" : "batch";
  const collectWaitMinutes = typeof args.wait === "string" ? Number(args.wait) : 0;
  if (!Number.isFinite(collectWaitMinutes) || collectWaitMinutes < 0) {
    console.error("ca:run: --wait must be a non-negative number of minutes");
    process.exit(1);
  }

  report.section(
    `ca:run  (mode=${mode}, days=${days}, max-per-source=${maxPerSource}, max-total=${maxTotal}` +
      `${mode === "batch" && collectWaitMinutes > 0 ? `, wait=${collectWaitMinutes}m` : ""})`,
  );

  const result = await runPipeline({ days, maxPerSource, maxTotal, mode, collectWaitMinutes }, (msg) =>
    report.step(msg),
  );

  report.section("Summary");
  report.ok(
    `kept: ${result.processed} (published: ${result.published}, draft: ${result.draft})  |  ARCHIVED by gate: ${result.archived}`,
  );
  report.ok(
    `lives — prelims: ${result.prelimsLife}, mains: ${result.mainsLife}, BOTH: ${result.dualLife}`,
  );
  report.ok(
    `generated — prelims MCQs: ${result.mcqsGenerated}, mains questions: ${result.mainsQuestionsGenerated}  |  cost: $${result.costUsd.toFixed(4)}`,
  );
  if (mode === "batch") {
    report.ok(
      `triage batches — submitted: ${result.submitted} (live on a later run), collected: ${result.collected}, ` +
        `collect-failed: ${result.collectFailed}  |  batches still pending: ${result.batchesPending}`,
    );
  }
  report.warn(
    `skipped — duplicate: ${result.skippedDuplicate}, too old: ${result.skippedOld}, no date: ${result.skippedNoDate}`,
  );
  if (result.cappedTotal > 0) {
    report.warn(`hit --max-total cap: ${result.cappedTotal} source(s) had remaining items left unprocessed`);
  }
  for (const failure of result.sourceFailures) {
    report.fail(`source "${failure.source}" failed: ${failure.error}`);
  }

  // Item-level failures (see ca/pipeline.ts's per-item try/catch) are never
  // fatal to the run by themselves, but a high failure rate is a signal of a
  // systemic problem (a model regression, a bad prompt change) rather than
  // one weird article — surface it loudly and exit non-zero above a sanity
  // threshold so it triggers the same CI/cron failure alerting as any other
  // real regression, instead of a quietly-degraded but "successful" run.
  //
  // Computed over items actually PROCESSED this run, in whichever mode ran.
  // Sync-mode items land in processed/archived; a batch-mode item is counted
  // exactly once as `collected` (which already covers persisted + archived +
  // duplicate), so the two are never summed together — that would double-count
  // every batch item. A run that only SUBMITS has 0 attempted and is correctly
  // exempt from the ratio (nothing was processed to fail).
  const itemFailures = result.enrichFailed + result.collectFailed;
  const itemsAttempted =
    result.collected + result.collectFailed + result.enrichFailed +
    (mode === "sync" ? result.processed + result.archived : 0);
  const ENRICH_FAILURE_FRACTION_THRESHOLD = 0.2;
  if (itemFailures > 0) {
    report.fail(
      `item failures — ${itemFailures}/${itemsAttempted} item(s) failed mid-pipeline (see log above); left unarchived for retry next run`,
    );
  } else {
    report.ok(`item failures — 0`);
  }
  if (itemsAttempted > 0 && itemFailures / itemsAttempted > ENRICH_FAILURE_FRACTION_THRESHOLD) {
    console.error(
      `\nca:run: ${itemFailures}/${itemsAttempted} items ` +
        `(${Math.round((itemFailures / itemsAttempted) * 100)}%) failed mid-pipeline — ` +
        `exceeds the ${Math.round(ENRICH_FAILURE_FRACTION_THRESHOLD * 100)}% sanity threshold. ` +
        `Exiting non-zero so this surfaces as a workflow failure rather than a silent partial run.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nca:run failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
