/**
 * Sukoon F12 — the hard side of the deletion lifecycle, run nightly by
 * scripts/sukoon-purge.ts. Two jobs:
 *   1. purgeExpiredExports — void export artifacts (+ storage objects) whose
 *      download window has closed, so a signed link can never outlive its job.
 *   2. purgeDeletedAccounts — for every account whose 7-day grace has elapsed,
 *      IRREVERSIBLY erase the user's Sukoon data.
 *
 * SCOPE: integrated mode erases only sukoon_ rows (the auth user + all Neev data
 * survive). Standalone mode deletes the auth user itself, which cascades every
 * sukoon_ table via the on-delete-cascade FKs — "whole account" per the blueprint.
 *
 * Erasure means erasure: no residual personal-data row is kept (not even the
 * privacy audit — that carries user_id + action). The purge is recorded to the
 * server log only, never back into a user-scoped table.
 */
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { selectAll } from "../../lib/paginate.js";
import { sukoonConfig } from "../config.js";

const EXPORTS_BUCKET = "sukoon-exports";

/**
 * User-scoped tables erased by an explicit per-user delete in INTEGRATED mode.
 * Excludes: sukoon_conversations (deleted separately so its messages cascade),
 * sukoon_subscriptions (billing_events pruned first), sukoon_profiles (last).
 */
const USER_TABLES = [
  "sukoon_consents",
  "sukoon_chat_summaries",
  "sukoon_memory_items",
  "sukoon_crisis_events",
  "sukoon_journal_entries",
  "sukoon_mood_entries",
  "sukoon_checkins",
  "sukoon_exercise_sessions",
  "sukoon_journey_progress",
  "sukoon_insights",
  "sukoon_usage",
  "sukoon_voice_usage",
  "sukoon_notification_log",
  "sukoon_export_jobs",
  "sukoon_privacy_audit",
  // Session 14 — analytics/feedback are personal data too (usage-pattern +
  // the user's own submitted opinions), so an integrated-mode erase covers
  // them the same as everything else above. sukoon_beta_cohort deliberately
  // excluded: it's ops allow-list metadata about the launch process, not
  // Sukoon content the user generated — it still gets erased on a WHOLE
  // Neev-account deletion via the auth.users cascade (0093), just not by this
  // narrower "erase my Sukoon data, keep my Neev account" path.
  "sukoon_analytics_events",
  "sukoon_feedback",
] as const;

export interface PurgeResult {
  expiredExports: number;
  purgedAccounts: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// 1. Expired export artifacts
// ---------------------------------------------------------------------------

interface ExpiredExportRow {
  id: string;
  user_id: string;
  json_path: string | null;
  journal_path: string | null;
}

async function purgeExpiredExports(dryRun: boolean): Promise<number> {
  const nowIso = new Date().toISOString();
  const due = await selectAll<ExpiredExportRow>(() =>
    supabase()
      .from("sukoon_export_jobs")
      .select("id, user_id, json_path, journal_path")
      .eq("status", "ready")
      .lt("expires_at", nowIso)
      .order("id", { ascending: true }),
  );
  if (due.length === 0) return 0;

  for (const job of due) {
    const paths = [job.json_path, job.journal_path].filter((p): p is string => !!p);
    if (dryRun) {
      logger.info({ jobId: job.id, paths }, "[dry-run] would expire export");
      continue;
    }
    if (paths.length > 0) {
      const { error } = await supabase().storage.from(EXPORTS_BUCKET).remove(paths);
      if (error) logger.warn({ jobId: job.id, error }, "export artifact removal failed");
    }
    await supabase()
      .from("sukoon_export_jobs")
      .update({ status: "expired", json_path: null, journal_path: null })
      .eq("id", job.id);
  }
  logger.info({ count: due.length, dryRun }, "sukoon expired exports processed");
  return due.length;
}

// ---------------------------------------------------------------------------
// 2. Hard-purge deactivated accounts past their grace window
// ---------------------------------------------------------------------------

/** Remove every export object under a user's storage prefix (best-effort). */
async function removeUserExportObjects(userId: string): Promise<void> {
  const store = supabase().storage.from(EXPORTS_BUCKET);
  const { data: jobDirs, error } = await store.list(userId);
  if (error || !jobDirs) return;
  const paths: string[] = [];
  for (const dir of jobDirs) {
    const { data: files } = await store.list(`${userId}/${dir.name}`);
    for (const f of files ?? []) paths.push(`${userId}/${dir.name}/${f.name}`);
  }
  if (paths.length > 0) {
    const { error: rmErr } = await store.remove(paths);
    if (rmErr) logger.warn({ userId, error: rmErr }, "user export objects removal failed");
  }
}

/** Integrated mode: erase sukoon_ rows for one user, keeping the auth user. */
async function eraseSukoonRows(userId: string): Promise<void> {
  const db = supabase();

  // billing_events reference subscriptions with ON DELETE SET NULL, so they
  // don't cascade — remove them explicitly (their payload can carry payment
  // metadata) before the subscriptions go.
  const { data: subs } = await db.from("sukoon_subscriptions").select("id").eq("user_id", userId);
  const subIds = ((subs as { id: string }[] | null) ?? []).map((s) => s.id);
  if (subIds.length > 0) {
    await db.from("sukoon_billing_events").delete().in("subscription_id", subIds);
  }

  // Conversations first → messages cascade off them.
  await db.from("sukoon_conversations").delete().eq("user_id", userId);

  for (const table of USER_TABLES) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  await db.from("sukoon_subscriptions").delete().eq("user_id", userId);
  // Profile last — its deletion completes the erasure.
  const { error: profErr } = await db.from("sukoon_profiles").delete().eq("user_id", userId);
  if (profErr) throw new Error(`sukoon_profiles: ${profErr.message}`);
}

async function purgeDeletedAccounts(dryRun: boolean): Promise<{ purged: number; errors: number }> {
  const nowIso = new Date().toISOString();
  const due = await selectAll<{ user_id: string; purge_after: string }>(() =>
    supabase()
      .from("sukoon_profiles")
      .select("user_id, purge_after")
      .not("deleted_at", "is", null)
      .lt("purge_after", nowIso)
      .order("user_id", { ascending: true }),
  );
  if (due.length === 0) return { purged: 0, errors: 0 };

  let purged = 0;
  let errors = 0;
  for (const row of due) {
    const userId = row.user_id;
    try {
      if (dryRun) {
        logger.info({ userId, mode: sukoonConfig.mode }, "[dry-run] would purge account");
        purged += 1;
        continue;
      }
      await removeUserExportObjects(userId);

      if (sukoonConfig.mode === "standalone") {
        // Whole-account erasure: deleting the auth user cascades every sukoon_
        // table via its on-delete-cascade FKs.
        const { error } = await supabase().auth.admin.deleteUser(userId);
        if (error) throw new Error(`auth deleteUser: ${error.message}`);
      } else {
        await eraseSukoonRows(userId);
      }
      // Recorded to the server log ONLY — no personal-data row survives a purge.
      logger.info({ userId, mode: sukoonConfig.mode }, "sukoon account purged");
      purged += 1;
    } catch (err) {
      errors += 1;
      logger.error({ userId, err }, "sukoon account purge failed — will retry next run");
    }
  }
  return { purged, errors };
}

/** Entry point for the nightly cron. */
export async function runSukoonPurge(opts: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const dryRun = opts.dryRun ?? false;
  const expiredExports = await purgeExpiredExports(dryRun);
  const { purged, errors } = await purgeDeletedAccounts(dryRun);
  return { expiredExports, purgedAccounts: purged, errors };
}
