/**
 * `pnpm ca:assemble [--days N] [--exam <code>]` — build (or return) this IST
 * week's two current-affairs sittings: the CA Prelims Quiz + the CA Mains Set.
 * Idempotent per (week, exam). What the weekly production cron invokes; also a
 * manual ops entry.
 *
 * With no `--exam` this builds for every LIVE exam, which is what the cron does.
 * `--exam <code>` may name a NON-live exam on purpose — stocking an unlaunched
 * exam is the real use case, and it is why `exams.is_live` must not be flipped
 * to make a pipeline see an exam (see lib/exams.ts's resolveTargetExams).
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { resolveTargetExams } from "../lib/exams.js";
import { assembleWeeklySets } from "./assemble.js";

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    { positiveNumber: ["days"], value: ["exam"] },
    "ca:assemble",
  );
  const days = typeof args.days === "string" ? Number(args.days) : 7;
  const { examCodes } = await resolveTargetExams({
    examArg: args.exam,
    cli: "ca:assemble",
    action: "assembling",
    log: (msg) => report.warn(msg),
  });

  report.section(
    `ca:assemble (week's sittings, last ${days} days of approved CA questions) — exams: ${examCodes.join(", ")}`,
  );
  const run = await assembleWeeklySets({ days, examCodes });

  report.ok(`IST week #${run.week}`);
  let assembledAny = false;
  for (const r of run.results) {
    report.ok(`[${r.examCode}] CA Prelims Quiz: ${r.prelimsTestId ?? "— (no approved CA MCQs yet)"}`);
    report.ok(`[${r.examCode}] CA Mains Set:    ${r.mainsTestId ?? "— (no approved CA descriptive questions yet)"}`);
    if (r.prelimsTestId || r.mainsTestId) assembledAny = true;
  }
  if (!assembledAny) {
    report.warn("Nothing assembled — approve CA questions in the Review Queue (CA / descriptive tabs) first.");
  }
}

main().catch((err) => {
  console.error("\nca:assemble failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
