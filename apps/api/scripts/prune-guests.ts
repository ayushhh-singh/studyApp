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
import { parseArgs, type FlagSpec } from "../src/ingest/_shared.js";

/**
 * This script DELETES auth users (cascading their profile rows) from a Supabase
 * project that is BOTH dev and production — so `--apply` and `--days` together are
 * the entire blast radius, and they must come from ONE parse, not two.
 *
 * They used to be read by two independent mechanisms — `process.argv.includes()`
 * for --apply and a private `argValue` (indexOf + next token) for --days — which
 * could disagree with each other about the same argv. The concrete hazard:
 * `guests:prune --days --apply` yielded `apply=true` AND `retentionDays=NaN`
 * simultaneously, because the valueless --days swallowed "--apply" as its value
 * while `includes()` still saw it. That only failed safe by accident — an unrelated
 * `new Date(NaN).toISOString()` RangeError in services/guest-cleanup.ts happens to
 * throw before any delete. Declaring `days` as positiveInt makes it fail LOUDLY and
 * on purpose, at parse time, instead of relying on a downstream coincidence.
 * (The old reader also scanned the raw `process.argv`, i.e. node's own binary and
 * script path, rather than `.slice(2)`.)
 */
const PRUNE_FLAGS: FlagSpec = {
  boolean: ["apply"],
  positiveInt: ["days"],
};

async function main() {
  const args = parseArgs(process.argv.slice(2), PRUNE_FLAGS, "guests:prune");
  const apply = args.apply === true;
  const retentionDays = typeof args.days === "string" ? Number(args.days) : undefined;

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
