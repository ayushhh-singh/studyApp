/**
 * Sukoon F12 — Privacy Center service: the "what's stored" summary, consent
 * history + withdrawal, and the account soft-delete lifecycle (immediate
 * deactivation → 7-day grace → hard purge by the nightly cron).
 *
 * DELETE SCOPE: this soft-deletes only the SUKOON account (sukoon_ rows), never
 * the underlying auth user or any Neev data — in integrated mode a person's Neev
 * account and study data are untouched. Standalone mode additionally erases the
 * auth user at PURGE time (scripts/sukoon-purge.ts), so the whole account goes.
 */
import type {
  SukoonAccountState,
  SukoonPrivacyDataCount,
  SukoonPrivacySummary,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { SUKOON_CONSENT_VERSION } from "../consent.js";
import { getLatestExportJob } from "./export.js";
import { recordPrivacyAction } from "./privacy-audit.js";

/** DPDP grace window: a deletion is fully reversible for this many days. */
export const SUKOON_PURGE_GRACE_DAYS = 7;

interface AccountRow {
  deleted_at: string | null;
  purge_after: string | null;
  deletion_reason: "user_request" | "consent_withdrawn" | null;
  onboarding_completed?: boolean;
}

async function readAccountRow(userId: string): Promise<AccountRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .select("deleted_at, purge_after, deletion_reason, onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon account lookup failed: ${error.message}`);
  return (data as AccountRow | null) ?? null;
}

function toAccountState(row: AccountRow | null): SukoonAccountState {
  const deleted = !!row?.deleted_at;
  return {
    status: deleted ? "scheduled_deletion" : "active",
    deleted_at: row?.deleted_at ?? null,
    purge_after: row?.purge_after ?? null,
    deletion_reason: row?.deletion_reason ?? null,
  };
}

export async function getAccountState(userId: string): Promise<SukoonAccountState> {
  return toAccountState(await readAccountRow(userId));
}

/**
 * Cheap "is this Sukoon account deactivated?" read for the access-revocation
 * middleware. A soft-deleted account is blocked from active features (chat,
 * journal writes, …) but can still reach the Privacy Center to restore/export.
 */
export async function isSukoonAccountDeleted(userId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .select("deleted_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon account state lookup failed: ${error.message}`);
  return !!(data as { deleted_at: string | null } | null)?.deleted_at;
}

// ---------------------------------------------------------------------------
// Summary — "what's stored about you"
// ---------------------------------------------------------------------------

async function count(builder: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: c } = await builder;
  return c ?? 0;
}

export async function getPrivacySummary(userId: string): Promise<SukoonPrivacySummary> {
  const db = supabase();
  const owned = (table: string) =>
    count(db.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId));

  const [
    journalEntries,
    conversations,
    chatMessages,
    moodEntries,
    checkins,
    exerciseSessions,
    journeyProgress,
    insights,
    crisisEvents,
    consentsRes,
    accountRow,
    latestExport,
    auditRes,
  ] = await Promise.all([
    owned("sukoon_journal_entries"),
    owned("sukoon_conversations"),
    // messages have no user_id — count through the owning conversation.
    count(
      db
        .from("sukoon_messages")
        .select("id, conversation:sukoon_conversations!inner(user_id)", { count: "exact", head: true })
        .eq("conversation.user_id", userId),
    ),
    owned("sukoon_mood_entries"),
    owned("sukoon_checkins"),
    owned("sukoon_exercise_sessions"),
    owned("sukoon_journey_progress"),
    owned("sukoon_insights"),
    owned("sukoon_crisis_events"),
    db
      .from("sukoon_consents")
      .select("consent_version, consented_at")
      .eq("user_id", userId)
      .order("consented_at", { ascending: false }),
    readAccountRow(userId),
    getLatestExportJob(userId),
    db
      .from("sukoon_privacy_audit")
      .select("action, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const data_counts: SukoonPrivacyDataCount[] = [
    { key: "journal_entries", count: journalEntries },
    { key: "conversations", count: conversations },
    { key: "chat_messages", count: chatMessages },
    { key: "mood_entries", count: moodEntries },
    { key: "checkins", count: checkins },
    { key: "exercise_sessions", count: exerciseSessions },
    { key: "journey_progress", count: journeyProgress },
    { key: "insights", count: insights },
    { key: "crisis_events", count: crisisEvents },
  ];

  const consents = ((consentsRes.data as { consent_version: string; consented_at: string }[] | null) ?? []).map(
    (c) => ({ consent_version: c.consent_version, consented_at: c.consented_at }),
  );
  const consent_current = consents.some((c) => c.consent_version === SUKOON_CONSENT_VERSION);

  const recent_actions = ((auditRes.data as { action: string; created_at: string }[] | null) ?? []).map((a) => ({
    action: a.action as SukoonPrivacySummary["recent_actions"][number]["action"],
    created_at: a.created_at,
  }));

  return {
    data_counts,
    consents,
    current_consent_version: SUKOON_CONSENT_VERSION,
    consent_current,
    account: toAccountState(accountRow),
    latest_export: latestExport,
    recent_actions,
  };
}

// ---------------------------------------------------------------------------
// Account deletion lifecycle
// ---------------------------------------------------------------------------

/**
 * Soft-delete (deactivate) the Sukoon account: immediate access revocation +
 * a 7-day grace window before the cron hard-purges. Idempotent — re-requesting
 * while already scheduled just returns the existing state (never extends the
 * clock, so the user can't accidentally push their own purge date out).
 */
export async function scheduleDeletion(
  userId: string,
  reason: "user_request" | "consent_withdrawn",
): Promise<SukoonAccountState> {
  const existing = await readAccountRow(userId);
  if (!existing) throw new HttpError(404, "No Sukoon account to delete — complete onboarding first");
  if (existing.deleted_at) return toAccountState(existing); // already scheduled — no-op

  const now = Date.now();
  const purgeAfter = new Date(now + SUKOON_PURGE_GRACE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .update({
      deleted_at: new Date(now).toISOString(),
      purge_after: purgeAfter,
      deletion_reason: reason,
    })
    .eq("user_id", userId)
    .is("deleted_at", null) // guard against a concurrent second delete
    .select("deleted_at, purge_after, deletion_reason")
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon account deletion failed: ${error.message}`);
  // Lost the race (another request set it first) → return current state.
  const row = (data as AccountRow | null) ?? (await readAccountRow(userId));

  await recordPrivacyAction(userId, reason === "consent_withdrawn" ? "consent_withdrawn" : "delete_requested", {
    purge_after: purgeAfter,
  });
  return toAccountState(row);
}

/** Restore a soft-deleted account inside the grace window. */
export async function cancelDeletion(userId: string): Promise<SukoonAccountState> {
  const existing = await readAccountRow(userId);
  if (!existing) throw new HttpError(404, "No Sukoon account found");
  if (!existing.deleted_at) return toAccountState(existing); // already active — no-op

  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .update({ deleted_at: null, purge_after: null, deletion_reason: null })
    .eq("user_id", userId)
    .select("deleted_at, purge_after, deletion_reason")
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon account restore failed: ${error.message}`);
  await recordPrivacyAction(userId, "delete_cancelled");
  return toAccountState((data as AccountRow | null) ?? null);
}
