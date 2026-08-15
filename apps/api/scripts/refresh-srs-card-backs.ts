/**
 * `pnpm srs:refresh-cards [--apply] [--user <uuid>]`
 *
 * Re-derives `back_i18n` for question-sourced SRS cards from their question's
 * CURRENT explanation. See `refreshQuestionCardBacks` in services/srs.ts for the
 * full rationale and the safety rule — in short: `addQuestionToRevision`
 * snapshots the explanation at add time, and 76% of the published bank has no
 * explanation until someone first views the question, so cards routinely start
 * answer-only and never pick up the explanation written afterwards.
 *
 * DRY-RUN BY DEFAULT. `--apply` is required to write, matching this repo's other
 * data-touching CLIs — and matters here because the same Supabase project serves
 * dev and production.
 *
 * Also runs nightly from `nightly:settle`, so this CLI is for a targeted or
 * out-of-band run rather than the normal path.
 */
import { parseArgs } from "../src/ingest/_shared.js";
import { refreshQuestionCardBacks } from "../src/services/srs.js";

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    { boolean: ["apply"], value: ["user"] },
    "srs:refresh-cards",
  );
  const apply = args.apply === true;
  const userId = typeof args.user === "string" ? args.user : undefined;

  const result = await refreshQuestionCardBacks({ apply, userId });
  console.log(
    `srs:refresh-cards${apply ? "" : " (dry run)"}${userId ? ` user=${userId}` : ""}: ` +
      `scanned ${result.scanned}, ${apply ? "refreshed" : "would refresh"} ${result.refreshed}, ` +
      `skipped ${result.skippedEdited} hand-edited, ${result.danglingSource} with a deleted source question`,
  );
  if (!apply && result.refreshed > 0) console.log("Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("srs:refresh-cards failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
