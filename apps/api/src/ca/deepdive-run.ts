/**
 * `pnpm ca:deepdive [--month YYYY-MM]`        — DRY RUN: rank this month's top
 *                                               issues + print a cost estimate.
 *                                               (Default is plan-only — never spends.)
 * `pnpm ca:deepdive --month YYYY-MM --run`    — actually generate the five deep
 *                                               dives via the Batch API and insert
 *                                               them as needs_review (clears any
 *                                               previous unpublished drafts for
 *                                               that month first).
 * `pnpm ca:deepdive --previous --run`         — the same, for the most recent
 *                                               FULLY ELAPSED IST month. This is
 *                                               the scheduled monthly invocation
 *                                               (.github/workflows/ca-deepdive.yml,
 *                                               1st of the month): on 1 Aug it
 *                                               compiles July 1-31 complete.
 * `pnpm ca:deepdive --previous --run --exam X` — restrict to one exam.
 *
 * Deep dives are PER EXAM (0118). With no `--exam` this builds for every LIVE
 * exam; `--exam` names one and, like ca:run's, may name a not-yet-live exam so
 * content can be built before launch (it says so, loudly).
 *
 * `--previous` exists so the schedule never has to compute a month itself. A
 * workflow doing `date -u +%Y-%m` would be UTC (this repo is IST throughout, and
 * `current_affairs_items.date` is `istDateString(pubDate)`) and would name the
 * CURRENT month, i.e. the one that has barely started.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { currentIstMonth, previousIstMonth } from "../lib/month.js";
import { resolveTargetExams } from "../lib/exams.js";
import { RELEVANCE_GATE } from "./pipeline.js";
import { planDeepDives, runDeepDives } from "./deepdive.js";

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    { value: ["month", "exam"], boolean: ["run", "previous"] },
    "ca:deepdive",
  );
  let failedExams = 0;
  const usePrevious = args.previous === true;
  // Refuse rather than silently pick a winner: the two flags name different
  // months, and a scheduled run that quietly compiled the wrong one would be
  // invisible (deep dives land as needs_review either way, both look plausible).
  if (usePrevious && typeof args.month === "string") {
    report.fail("--previous and --month are mutually exclusive; pass one or the other");
    process.exit(1);
  }
  const month = usePrevious
    ? previousIstMonth()
    : typeof args.month === "string"
      ? args.month
      : currentIstMonth();
  // `run` is declared boolean, so the parser yields only `true` or `undefined`
  // — the old `|| args.run === "true"` branch is now dead.
  const doRun = args.run === true;

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    report.fail(`--month must be YYYY-MM, got "${month}"`);
    process.exit(1);
  }

  // Deep dives are PER EXAM (0118). With no --exam this builds for every LIVE
  // exam, matching ca:run/ca:backfill/qgen:topup via the one shared resolver —
  // so a scheduled run can never inherit a pre-launch override, and adding a
  // second live exam needs no change here.
  const { examCodes, overridden } = await resolveTargetExams({
    examArg: args.exam,
    cli: "ca:deepdive",
    action: "generating deep dives",
    log: (m) => report.warn(m),
  });
  report.step(`exams: ${examCodes.join(", ")}${overridden ? " (--exam override)" : " (live set)"}`);

  let anyPlanned = 0;
  const summaries: string[] = [];

  for (const examCode of examCodes) {
    const plan = await planDeepDives(month, examCode);
    report.section(`ca:deepdive — plan for ${month} / ${examCode}`);
    report.ok(`candidate issues ranked: ${plan.count}`);
    for (const [i, title] of plan.titles.entries()) report.step(`  ${i + 1}. ${title}`);
    report.ok(`ESTIMATED COST (Batch API): $${plan.estimatedCostUsd.toFixed(4)}`);
    anyPlanned += plan.count;

    if (plan.count === 0) {
      report.warn(
        `No published mains-life items with mains_relevance >= ${RELEVANCE_GATE} for ${month} / ${examCode} — nothing to generate.`,
      );
      continue;
    }
    if (!doRun) continue;

    report.section(`ca:deepdive — RUN for ${month} / ${examCode}`);
    // One exam's failure must not abort the others: each is an independent
    // batch, and a partial month is recoverable by re-running that exam alone.
    try {
      const res = await runDeepDives(month, examCode, (m) => report.step(m));
      summaries.push(
        `${examCode}: generated ${res.generated}/${res.planned} (failed: ${res.failed}), $${res.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.fail(`${examCode} FAILED: ${message}`);
      summaries.push(`${examCode}: FAILED — ${message}`);
      failedExams++;
    }
  }

  if (!doRun) {
    report.section("Dry run — nothing spent");
    if (anyPlanned > 0) {
      report.step(`Re-run with \`--run\` to generate + insert (needs_review, awaiting Review Queue approval).`);
    }
    return;
  }

  report.section("Summary");
  for (const s of summaries) report.ok(s);
  if (summaries.some((s) => !s.includes("FAILED"))) {
    report.step("Awaiting review in the admin Review Queue's Magazine tab before they appear in the Mains Analysis edition.");
  }
  // A cron must go red when an exam failed — otherwise a silently-empty month
  // reads as a successful run (the false-green class ca-run.yml's own guard and
  // forEachUser's throwOnListFailure both exist for).
  if (failedExams > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nca:deepdive failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
