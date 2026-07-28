/**
 * `pnpm --filter api guests:prune [--apply] [--days N]` — prune abandoned
 * anonymous (guest) accounts. DRY-RUN by default (prints what it WOULD delete);
 * pass `--apply` to actually delete. `--days` overrides GUEST_RETENTION_DAYS.
 *
 * Safe: only touches `is_anonymous` users that are BOTH older than the retention
 * window AND inactive within it, re-confirming anonymity before each delete —
 * see services/guest-cleanup.ts. Also run nightly by nightly:settle.
 */
import { pruneAbandonedGuests } from "../src/services/guest-cleanup.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const daysArg = argValue("--days");
  const retentionDays = daysArg ? Number(daysArg) : undefined;

  const r = await pruneAbandonedGuests({ apply, retentionDays });
  console.log(
    `guests:prune — retention ${r.retentionDays}d | old anonymous: ${r.oldAnonymous} | eligible (old + inactive): ${r.eligible} | ${
      r.applied ? `PRUNED: ${r.pruned}` : "DRY RUN (pass --apply to delete)"
    }`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("guests:prune failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
