/**
 * `pnpm mastery:build [--user <uuid>]` — recompute node mastery for a user on
 * demand. Normally runs after each attempt submit and nightly (daily/scheduler);
 * this is the manual/backfill entry point.
 */
import { parseArgs } from "../ingest/_shared.js";
import { listAllUserIds } from "../lib/users.js";
import { recomputeMastery } from "./compute.js";

async function main() {
  // ⚑ THE WIDENING SHAPE THIS GUARDS. Absent `--user`, this script recomputes
  // `node_mastery` for EVERY user in the database — the same Supabase project
  // for dev AND prod. The previous hand-rolled loop (`if (argv[i] === "--user")`)
  // could not see a COLLAPSED token: `pnpm mastery:build "$a"` with
  // `a="--user <uuid>"` arrives as ONE argv element under zsh, matches nothing,
  // leaves `userArg` undefined and silently fans a single-user backfill out to
  // an all-users write — the 2026-07-31 incident's exact shape
  // (docs/OUTSTANDING.md §0d). The shared parser refuses it instead.
  const args = parseArgs(process.argv.slice(2), { value: ["user"] }, "mastery:build");
  const userArg = typeof args.user === "string" ? args.user : undefined;
  const userIds = userArg ? [userArg] : await listAllUserIds();
  for (const userId of userIds) {
    const n = await recomputeMastery(userId);
    console.log(`mastery: recomputed ${n} node(s) for ${userId}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("mastery:build failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
