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
 * failures so one user's error never stops the rest of the batch. Shared by
 * the dev-only in-process scheduler (daily/scheduler.ts) and the standalone
 * CLI entrypoints production's external cron invokes directly (scripts/).
 */
export async function forEachUser(label: string, fn: (userId: string) => Promise<unknown>): Promise<void> {
  let userIds: string[];
  try {
    userIds = await listAllUserIds();
  } catch (err) {
    logger.error({ err }, `${label} — could not list users`);
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
