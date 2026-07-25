/**
 * `pnpm sukoon:purge` — the nightly Sukoon privacy purge (blueprint F12).
 *   1. voids expired data-export artifacts (+ their storage objects), and
 *   2. hard-erases accounts whose 7-day deletion grace has elapsed.
 *
 * IRREVERSIBLE. Pass `--dry-run` to log what WOULD be erased without touching
 * anything (the workflow_dispatch path uses this). Schedule nightly — see
 * .github/workflows/sukoon-purge.yml (00:35 IST, after the day's activity).
 *
 * Erasure scope is set by SUKOON_MODE (integrated = sukoon_ rows only; standalone
 * = the whole auth user). Supabase is reached via the shared service-role client.
 */
import { runSukoonPurge } from "../src/sukoon/services/purge.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await runSukoonPurge({ dryRun });
  console.log(
    `sukoon:purge${dryRun ? " [dry-run]" : ""}: expired ${result.expiredExports} export(s), ` +
      `purged ${result.purgedAccounts} account(s), ${result.errors} error(s)`,
  );
  // A purge that hit per-account errors still "succeeded" as a run (each failed
  // account stays due and retries tomorrow); only a thrown error fails the job.
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sukoon:purge failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
