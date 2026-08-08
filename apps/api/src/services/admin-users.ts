/**
 * Admin "Users" surface — search a specific account by email, then grant or
 * revoke Pro access / admin privilege, with every action logged to
 * `admin_grants` (migration 0117) for auditability.
 *
 * Deliberately reuses the EXISTING access-control fields rather than
 * inventing a parallel one:
 *   - Pro access  = users_profile.plan + plan_expires_at, the same fields
 *     services/entitlements.ts::getPlanFor reads for every metered endpoint.
 *   - Admin access = users_profile.is_admin, the same flag
 *     lib/admin.ts::requireAdmin checks for the whole /admin/* surface.
 *
 * A grant here is deliberately INDEFINITE (plan_expires_at set to null, never
 * a days-based expiry): getTrialContext's isOnTrial requires an expiry AND
 * has_used_trial together to read a Pro grant as the 7-day signup trial (its
 * own doc comment: "a manual/admin Pro grant — which leaves the flag false —
 * is never treated as a trial"). That guard only holds if has_used_trial is
 * false OR there is no expiry. A user who already burned a real trial
 * (has_used_trial=true) would misclassify as "on trial" — with its tighter
 * 2/day evaluation cap — if this granted a time-boxed Pro instead. Never
 * touching has_used_trial and never setting an expiry sidesteps that
 * misclassification entirely: this always resolves as full paid-equivalent
 * Pro (60/mo evaluations, 100/day mentor), regardless of trial history.
 */
import type { AdminGrantAction, AdminUserSummary, TargetExamCode } from "@neev/shared";
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";

interface AuthUserLike {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  created_at?: string;
}

interface ProfileRow {
  display_name: string | null;
  plan: AdminUserSummary["plan"];
  plan_expires_at: string | null;
  has_used_trial: boolean;
  is_admin: boolean;
  target_exam: string;
  created_at: string;
}

const PROFILE_COLUMNS = "display_name, plan, plan_expires_at, has_used_trial, is_admin, target_exam, created_at";

/** Page size for the "all users" list — mirrors REVIEW_PAGE_SIZE's convention. */
export const ADMIN_USER_LIST_PAGE_SIZE = 20;

function buildSummary(authUser: AuthUserLike, profile: ProfileRow | undefined): AdminUserSummary {
  return {
    id: authUser.id,
    email: authUser.email ?? null,
    is_anonymous: authUser.is_anonymous === true,
    display_name: profile?.display_name ?? null,
    plan: profile?.plan ?? "free",
    plan_expires_at: profile?.plan_expires_at ?? null,
    has_used_trial: profile?.has_used_trial ?? false,
    is_admin: profile?.is_admin ?? false,
    target_exam: (profile?.target_exam as TargetExamCode | undefined) ?? DEFAULT_EXAM_CODE,
    created_at: profile?.created_at ?? authUser.created_at ?? new Date(0).toISOString(),
  };
}

async function toSummary(authUser: AuthUserLike): Promise<AdminUserSummary> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select(PROFILE_COLUMNS)
    .eq("id", authUser.id)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  return buildSummary(authUser, (data ?? undefined) as ProfileRow | undefined);
}

/**
 * Every auth user, across all pages of the Admin Auth API (no server-side
 * email/name filter exists on `listUsers`, so browsing/filtering happens in
 * memory here — matching the established pattern in guest-cleanup.ts). Fine
 * for an admin-only, rate-limited, infrequent endpoint at this app's real
 * user count; would need a real cursor/index if that ever reaches the tens
 * of thousands.
 */
async function listAllAuthUsers(): Promise<AuthUserLike[]> {
  const perPage = 1000;
  const all: AuthUserLike[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase().auth.admin.listUsers({ page, perPage });
    if (error) throw new HttpError(500, `user list failed: ${error.message}`);
    const users = data.users ?? [];
    all.push(...users);
    if (users.length < perPage) break;
  }
  return all;
}

/** Batch-load profile rows for a set of ids — one query per 100 ids (the established `.in()` chunk-size convention), never one query per user. */
async function loadProfilesByIds(ids: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase()
      .from("users_profile")
      .select(`id, ${PROFILE_COLUMNS}`)
      .in("id", chunk);
    if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
    for (const row of (data ?? []) as (ProfileRow & { id: string })[]) map.set(row.id, row);
  }
  return map;
}

/**
 * Every account, newest first, optionally narrowed by `query` (a
 * case-insensitive substring match against email OR display name — never an
 * exact-only match, so an admin can browse without knowing a full address).
 * Paginated server-side so the response stays small regardless of the
 * underlying user count.
 */
export async function listUsers(opts: { page: number; query?: string }): Promise<{ items: AdminUserSummary[]; total: number }> {
  const authUsers = await listAllAuthUsers();
  const profilesById = await loadProfilesByIds(authUsers.map((u) => u.id));
  let summaries = authUsers.map((u) => buildSummary(u, profilesById.get(u.id)));

  const needle = opts.query?.trim().toLowerCase();
  if (needle) {
    summaries = summaries.filter(
      (s) => (s.email ?? "").toLowerCase().includes(needle) || (s.display_name ?? "").toLowerCase().includes(needle),
    );
  }

  summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const total = summaries.length;
  const from = (opts.page - 1) * ADMIN_USER_LIST_PAGE_SIZE;
  const items = summaries.slice(from, from + ADMIN_USER_LIST_PAGE_SIZE);
  return { items, total };
}

async function requireUserSummary(userId: string): Promise<AdminUserSummary> {
  const { data, error } = await supabase().auth.admin.getUserById(userId);
  if (error || !data?.user) throw notFound("User not found");
  return toSummary(data.user);
}

async function logGrant(
  adminUserId: string,
  targetUserId: string,
  action: AdminGrantAction,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase()
    .from("admin_grants")
    .insert({ admin_user_id: adminUserId, target_user_id: targetUserId, action, detail });
  if (error) throw new HttpError(500, `audit log write failed: ${error.message}`);
}

/**
 * Apply a `users_profile` patch and 404 if it touched ZERO rows.
 *
 * `requireUserSummary`'s upfront check only confirms the AUTH user exists —
 * `handle_new_user()` guarantees every real signup gets a profile row too,
 * but an orphaned/corrupted profile (deleted out-of-band, or a mid-signup
 * race) would otherwise let `.update(...).eq("id", targetUserId)` silently
 * affect 0 rows: Supabase does not error on a no-match update, so the caller
 * would see a 200 "success" while nothing actually changed, and the returned
 * summary would keep showing the OLD (default) values forever. Selecting the
 * updated row back turns that silent no-op into an honest 404.
 */
async function updateProfileOrNotFound(targetUserId: string, patch: Record<string, unknown>, action: string): Promise<void> {
  const { data, error } = await supabase().from("users_profile").update(patch).eq("id", targetUserId).select("id");
  if (error) throw new HttpError(500, `${action} failed: ${error.message}`);
  if (!data || data.length === 0) throw notFound("User not found");
}

/**
 * Grant Pro access. `days` is optional — omit/null for the original
 * indefinite grant (see the module doc comment for why that is the only
 * option that can NEVER be misread as the 7-day signup trial); when set, the
 * grant expires that many days from now. Never touches `has_used_trial`
 * either way, matching the module's core invariant.
 */
export async function grantPro(adminUserId: string, targetUserId: string, days: number | null = null): Promise<AdminUserSummary> {
  const before = await requireUserSummary(targetUserId);
  const planExpiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
  await updateProfileOrNotFound(targetUserId, { plan: "pro", plan_expires_at: planExpiresAt }, "grant pro");
  await logGrant(adminUserId, targetUserId, "grant_pro", { previous_plan: before.plan, days, expires_at: planExpiresAt });
  return requireUserSummary(targetUserId);
}

export async function revokePro(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  const before = await requireUserSummary(targetUserId);
  await updateProfileOrNotFound(targetUserId, { plan: "free", plan_expires_at: null }, "revoke pro");
  await logGrant(adminUserId, targetUserId, "revoke_pro", { previous_plan: before.plan });
  return requireUserSummary(targetUserId);
}

export async function grantAdmin(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  await requireUserSummary(targetUserId);
  await updateProfileOrNotFound(targetUserId, { is_admin: true }, "grant admin");
  await logGrant(adminUserId, targetUserId, "grant_admin");
  return requireUserSummary(targetUserId);
}

/**
 * An admin may never revoke their OWN admin access through this surface — a
 * self-inflicted lockout would need a direct DB edit to undo. Revoking a
 * DIFFERENT admin's access is allowed (that's an ordinary privilege decision,
 * fully logged below).
 */
export async function revokeAdmin(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  if (adminUserId === targetUserId) {
    throw badRequest("You can't revoke your own admin access here — ask another admin to do it.");
  }
  await requireUserSummary(targetUserId);
  await updateProfileOrNotFound(targetUserId, { is_admin: false }, "revoke admin");
  await logGrant(adminUserId, targetUserId, "revoke_admin");
  return requireUserSummary(targetUserId);
}

interface GrantLogRow {
  id: string;
  admin_user_id: string | null;
  action: AdminGrantAction;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/**
 * The audit trail for one target user, most recent first, with each acting
 * admin's email resolved for display. Small N (an admin-action log, not a
 * hot path) — one `getUserById` per DISTINCT admin in the page is fine.
 */
export async function getGrantLog(targetUserId: string) {
  const { data, error } = await supabase()
    .from("admin_grants")
    .select("id, admin_user_id, action, detail, created_at")
    .eq("target_user_id", targetUserId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new HttpError(500, `grant log lookup failed: ${error.message}`);
  const rows = (data ?? []) as GrantLogRow[];

  const adminIds = [...new Set(rows.map((r) => r.admin_user_id).filter((id): id is string => !!id))];
  const emailById = new Map<string, string | null>();
  for (const id of adminIds) {
    const { data: u } = await supabase().auth.admin.getUserById(id);
    emailById.set(id, u?.user?.email ?? null);
  }

  return rows.map((r) => ({
    id: r.id,
    admin_user_id: r.admin_user_id,
    admin_email: r.admin_user_id ? (emailById.get(r.admin_user_id) ?? null) : null,
    action: r.action,
    detail: r.detail ?? {},
    created_at: r.created_at,
  }));
}
