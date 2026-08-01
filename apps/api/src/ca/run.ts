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
 *
 * CONTENT TARGETING (`--exam <code>`): by default the run builds for every LIVE
 * exam. `--exam` names ONE exam explicitly and may name a NOT-YET-LIVE one, so
 * an exam's current-affairs corpus can be built BEFORE launch without flipping
 * `exams.is_live` — which would also make it selectable by real users
 * (docs/OUTSTANDING.md U7). See `resolveTargetExams`.
 *
 * ⚑ `--exam` AND THE TRIAGE-BATCH LEDGER DO NOT MIX ACROSS RUNS. A pending batch
 * carries the exams it was SUBMITTED for, and collect rebuilds each request's
 * shown-candidate list from THIS run's pools — so collecting a uppsc batch under
 * `--exam upsc` would resolve none of its node ids and generate none of its
 * questions, silently. The guard below refuses rather than degrade; drain first.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { resolveTargetExams } from "../lib/exams.js";
import { listPendingBatches } from "./triage-batch-store.js";
import { runPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    {
      // `exam` is the content-targeting override (see the header). A `value`
      // flag, so a valueless `--exam` is rejected by the parser rather than
      // collapsing to boolean `true` and silently falling back to the live set.
      value: ["mode", "exam"],
      // `days` is a positiveNumber, NOT a positiveInt: it is compared against a
      // FRACTIONAL `ageDays` float downstream, so `--days 0.5` (a 12-hour
      // window) is a semantically valid narrowing an integer validator would
      // wrongly reject.
      positiveNumber: ["days"],
      positiveInt: ["max-per-source", "max-total"],
      // `wait` MUST be nonNegativeNumber, not positiveNumber: `--wait 0` means
      // "submit the batch and exit without polling" and is the CRON'S OWN
      // VALUE (see the header). A strictly-positive validator would reject the
      // scheduled run outright.
      nonNegativeNumber: ["wait"],
    },
    "ca:run",
  );
  // Resolved BEFORE anything is read or spent, so an unknown code dies here.
  const { examCodes, overridden } = await resolveTargetExams({
    examArg: args.exam,
    cli: "ca:run",
    action: "ingesting",
    log: (m) => report.warn(m),
  });
  const days = typeof args.days === "string" ? Number(args.days) : 3;
  const maxPerSource = typeof args["max-per-source"] === "string" ? Number(args["max-per-source"]) : 15;
  const maxTotal = typeof args["max-total"] === "string" ? Number(args["max-total"]) : 40;
  const mode = args.mode === "sync" ? "sync" : "batch";
  // No hand-rolled finite/>=0 check here any more — the parser's
  // `nonNegativeNumber` kind enforces exactly that, before anything is spent.
  const collectWaitMinutes = typeof args.wait === "string" ? Number(args.wait) : 0;

  // ⚑ REFUSE TO MIX A TARGETED RUN WITH SOMEONE ELSE'S PENDING BATCH.
  //
  // A pending triage batch was submitted for the exams that were in scope AT
  // SUBMIT TIME, and `collectBatch` rebuilds each request's shown-candidate list
  // from THIS run's `candidateById` — which is built only from this run's target
  // exams. Collect a uppsc batch under `--exam upsc` and every stored uppsc node
  // id resolves to nothing: the item is persisted with no syllabus mapping, its
  // exam bookkeeping falls back, and `scopeFor` returns undefined so no MCQ and
  // no mains question is generated for it. All silent, and the ledger row is
  // marked collected, so the work is gone rather than retried.
  //
  // Rather than teach collect to reconstruct pools for exams this run is not
  // building for (real complexity, on a path nobody exercises), refuse and say
  // exactly what to do. The reverse direction is the operator's to respect: a
  // batch SUBMITTED under `--exam X` must be collected under `--exam X` too.
  if (overridden) {
    const pending = await listPendingBatches();
    if (pending.length > 0) {
      const items = pending.reduce((n, b) => n + b.count, 0);
      console.error(
        `\nca:run --exam ${examCodes[0]}: ${pending.length} triage batch(es) covering ${items} item(s) are still ` +
          `pending. They were submitted for a DIFFERENT exam scope, and collecting them under this one would ` +
          `silently drop their syllabus mappings and generate none of their questions.\n` +
          `Drain them first with a plain \`pnpm ca:run --wait <minutes>\` (no --exam), then re-run this command.\n` +
          `Pending: ${pending.map((b) => `${b.batchId} (${b.count} items, submitted ${b.submittedAt})`).join("; ")}`,
      );
      process.exit(1);
    }
  }

  report.section(
    `ca:run  (mode=${mode}, days=${days}, max-per-source=${maxPerSource}, max-total=${maxTotal}` +
      `${mode === "batch" && collectWaitMinutes > 0 ? `, wait=${collectWaitMinutes}m` : ""}` +
      `, exams=${examCodes.join(",")}${overridden ? " [--exam override]" : " [live set]"})`,
  );

  const result = await runPipeline({ days, maxPerSource, maxTotal, mode, collectWaitMinutes, examCodes }, (msg) =>
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
  // Shown in batch mode always, and in sync mode too when it actually touched a
  // batch — sync now drains any batch left pending by an earlier batch-mode run.
  if (
    mode === "batch" ||
    result.collected > 0 ||
    result.collectFailed > 0 ||
    result.batchesPending > 0
  ) {
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

  // A per-SOURCE RSS fetch failure (one feed down) is expected/transient and
  // stays a warning — one flaky feed must not red the whole cron. But the batch
  // TRANSPORT failing is systemic: submitBatch throwing (bad ANTHROPIC_API_KEY,
  // a deprecated model id, a network/Anthropic outage) or a collect throwing
  // are reported under the reserved source id "triage-batch", and a persistent
  // one of those would otherwise produce a green run every 6h forever while
  // silently doing no triage. Those exit non-zero so the same alerting fires as
  // for any other systemic failure. (They increment neither enrichFailed nor
  // collectFailed, so the item-ratio gate below would never catch them.)
  const transportFailed = result.sourceFailures.some((f) => f.source === "triage-batch");

  // Item-level failures (see ca/pipeline.ts's per-item try/catch) are never
  // fatal to the run by themselves, but a high failure rate is a signal of a
  // systemic problem (a model regression, a bad prompt change) rather than
  // one weird article — surface it loudly and exit non-zero above a sanity
  // threshold so it triggers the same CI/cron failure alerting as any other
  // real regression, instead of a quietly-degraded but "successful" run.
  //
  // Denominator is mode-AGNOSTIC: processTriagedItem (the one funnel every kept
  // item passes through, sync-fed OR batch-collected) increments processed /
  // archived, so `processed + archived` already counts every collected item
  // exactly once. Adding `result.collected` on top would DOUBLE-count each
  // collected item — which is exactly what happens now that collect runs in
  // sync mode too (a sync run that drains a pending batch bumps both). So the
  // ratio is built only from the funnel counters + the two failure counters.
  // A submit-only run has 0 of all four → 0 attempted → correctly exempt.
  // Duplicates (23505) land in skippedDuplicate, not processed/archived, so
  // they're excluded from the ratio (neither fresh work nor a failure).
  const itemFailures = result.enrichFailed + result.collectFailed;
  const itemsAttempted =
    result.processed + result.archived + result.enrichFailed + result.collectFailed;
  const ENRICH_FAILURE_FRACTION_THRESHOLD = 0.2;
  if (itemFailures > 0) {
    report.fail(
      `item failures — ${itemFailures}/${itemsAttempted} item(s) failed mid-pipeline (see log above); left unarchived for retry next run`,
    );
  } else {
    report.ok(`item failures — 0`);
  }
  const ratioBreached =
    itemsAttempted > 0 && itemFailures / itemsAttempted > ENRICH_FAILURE_FRACTION_THRESHOLD;
  if (transportFailed) {
    console.error(
      `\nca:run: the triage batch transport failed this run (see the "triage-batch" failure above) — ` +
        `submit/collect could not talk to the Message Batches API. Exiting non-zero so a persistent ` +
        `misconfiguration or outage surfaces as a workflow failure rather than a silently no-op run.`,
    );
    process.exit(1);
  }
  if (ratioBreached) {
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
