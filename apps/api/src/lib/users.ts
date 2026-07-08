import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

/**
 * All onboarded user ids. Background jobs (nightly schedulers, `pnpm *:build`
 * CLIs) used to run for the single DEV_USER_ID; post-auth they iterate every
 * real user instead. Only onboarded profiles are included — a half-signed-up
 * account with no data yet has nothing to recompute.
 */
export async function listAllUserIds(): Promise<string[]> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("id")
    .eq("onboarding_completed", true);
  if (error) throw new Error(`listAllUserIds failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/**
 * Run a per-user nightly/hourly job for every onboarded user, isolating
 * per-user failures so one user's error never stops the rest of the batch.
 * Shared by the dev-only in-process scheduler (daily/scheduler.ts) and the
 * standalone CLI entrypoints production's external cron invokes directly
 * (scripts/). A failure to even LIST users is different from a per-user
 * failure — in the always-running dev scheduler it's fine to swallow and
 * retry on the next tick, but a one-shot cron script that swallowed it would
 * exit 0 having silently done nothing, and Render would report the run as a
 * success. `throwOnListFailure` lets the CLI scripts opt into surfacing that
 * as a real, non-zero-exit failure instead.
 */
export async function forEachUser(
  label: string,
  fn: (userId: string) => Promise<unknown>,
  opts: { throwOnListFailure?: boolean } = {},
): Promise<void> {
  let userIds: string[];
  try {
    userIds = await listAllUserIds();
  } catch (err) {
    logger.error({ err }, `${label} — could not list users`);
    if (opts.throwOnListFailure) throw err;
    return;
  }
  for (const userId of userIds) {
    try {
      await fn(userId);
    } catch (err) {
      logger.error({ err, userId }, `${label} failed for user`);
    }
  }
}
