/**
 * `pnpm mastery:build [--user <uuid>]` — recompute node mastery for a user on
 * demand. Normally runs after each attempt submit and nightly (daily/scheduler);
 * this is the manual/backfill entry point.
 */
import { devUserId } from "../lib/dev-user.js";
import { recomputeMastery } from "./compute.js";

async function main() {
  const argv = process.argv.slice(2);
  let userId = devUserId();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") userId = argv[++i];
  }
  const n = await recomputeMastery(userId);
  console.log(`mastery: recomputed ${n} node(s) for ${userId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("mastery:build failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
