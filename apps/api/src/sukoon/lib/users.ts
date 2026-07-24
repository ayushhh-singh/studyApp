/**
 * Sukoon-scoped user enumeration for background jobs (F11 reminders). A
 * self-contained mirror of ../../lib/users.ts's forEachUser/listAllUserIds,
 * sourced from sukoon_profiles rather than Neev's users_profile — a Sukoon
 * cron must never depend on a Neev feature table (CLAUDE.md's isolation
 * rule), and Sukoon's own user set (onboarded here) is a different, smaller
 * population than Neev's anyway.
 */
import { logger } from "../../lib/logger.js";
import { supabase } from "../../lib/supabase.js";
import { selectAll } from "../../lib/paginate.js";

/**
 * Every user who has finished SUKOON onboarding
 * (sukoon_profiles.onboarding_completed). Paged via selectAll rather than a
 * plain `.select()` — PostgREST caps an unranged select at 1000 rows
 * server-side (a real, repeat-offender bug class in this repo; see
 * lib/paginate.ts's header), which would silently drop users past the cap
 * from EVERY reminder tick with no error. Sukoon's user base is small today,
 * but there's no reason to bake in a cap that only starts lying once it's
 * actually reached.
 */
export async function listSukoonUserIds(): Promise<string[]> {
  const rows = await selectAll<{ user_id: string }>(() =>
    supabase().from("sukoon_profiles").select("user_id").eq("onboarding_completed", true),
  );
  return rows.map((r) => r.user_id);
}

/**
 * Run a per-user job for every onboarded Sukoon user, isolating per-user
 * failures so one user's error never stops the rest of the batch. Mirrors
 * lib/users.ts's forEachUser exactly (including `throwOnListFailure`, so the
 * standalone cron script can surface a total list-failure as a real non-zero
 * exit instead of a false-green "did nothing" run).
 */
export async function forEachSukoonUser(
  label: string,
  fn: (userId: string) => Promise<unknown>,
  opts: { throwOnListFailure?: boolean } = {},
): Promise<void> {
  let userIds: string[];
  try {
    userIds = await listSukoonUserIds();
  } catch (err) {
    logger.error({ err }, `${label} — could not list sukoon users`);
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
