/**
 * `pnpm mastery:build [--user <uuid>]` — recompute node mastery for a user on
 * demand. Normally runs after each attempt submit and nightly (daily/scheduler);
 * this is the manual/backfill entry point.
 */
import { listAllUserIds } from "../lib/users.js";
import { recomputeMastery } from "./compute.js";

async function main() {
  const argv = process.argv.slice(2);
  let userArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") userArg = argv[++i];
  }
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
