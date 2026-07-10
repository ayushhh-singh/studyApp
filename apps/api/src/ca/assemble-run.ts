/**
 * `pnpm ca:assemble [--days N]` — build (or return) this IST week's two
 * current-affairs sittings: the CA Prelims Quiz + the CA Mains Set. Idempotent
 * per week. What the weekly production cron invokes; also a manual ops entry.
 */
import { parseArgs, report } from "../ingest/_shared.js";
import { assembleWeeklySets } from "./assemble.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const days = typeof args.days === "string" ? Number(args.days) : 7;

  report.section(`ca:assemble (week's sittings, last ${days} days of approved CA questions)`);
  const result = await assembleWeeklySets(days);

  report.ok(`IST week #${result.week}`);
  report.ok(`CA Prelims Quiz: ${result.prelimsTestId ?? "— (no approved CA MCQs yet)"}`);
  report.ok(`CA Mains Set:    ${result.mainsTestId ?? "— (no approved CA descriptive questions yet)"}`);
  if (!result.prelimsTestId && !result.mainsTestId) {
    report.warn("Nothing assembled — approve CA questions in the Review Queue (CA / descriptive tabs) first.");
  }
}

main().catch((err) => {
  console.error("\nca:assemble failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
