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

async function toSummary(authUser: AuthUserLike): Promise<AdminUserSummary> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select(PROFILE_COLUMNS)
    .eq("id", authUser.id)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  const p = (data ?? null) as ProfileRow | null;
  return {
    id: authUser.id,
    email: authUser.email ?? null,
    is_anonymous: authUser.is_anonymous === true,
    display_name: p?.display_name ?? null,
    plan: p?.plan ?? "free",
    plan_expires_at: p?.plan_expires_at ?? null,
    has_used_trial: p?.has_used_trial ?? false,
    is_admin: p?.is_admin ?? false,
    target_exam: (p?.target_exam as TargetExamCode | undefined) ?? DEFAULT_EXAM_CODE,
    created_at: p?.created_at ?? authUser.created_at ?? new Date(0).toISOString(),
  };
}

/**
 * Find one account by EXACT email (case-insensitive) — never a substring
 * search, so this can't be used to browse/enumerate the user base. Pages
 * through the Admin Auth API (no server-side email filter exists on
 * `listUsers`, matching the established pattern in guest-cleanup.ts) and
 * stops at the first match. Returns null for "no such account", a real and
 * expected outcome, not an error.
 */
export async function findUserByEmail(email: string): Promise<AdminUserSummary | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase().auth.admin.listUsers({ page, perPage });
    if (error) throw new HttpError(500, `user search failed: ${error.message}`);
    const users = data.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === needle);
    if (hit) return toSummary(hit);
    if (users.length < perPage) break;
  }
  return null;
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

/** Grant indefinite Pro access (see the module doc comment for why no expiry). */
export async function grantPro(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  const before = await requireUserSummary(targetUserId);
  const { error } = await supabase()
    .from("users_profile")
    .update({ plan: "pro", plan_expires_at: null })
    .eq("id", targetUserId);
  if (error) throw new HttpError(500, `grant pro failed: ${error.message}`);
  await logGrant(adminUserId, targetUserId, "grant_pro", { previous_plan: before.plan });
  return requireUserSummary(targetUserId);
}

export async function revokePro(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  const before = await requireUserSummary(targetUserId);
  const { error } = await supabase()
    .from("users_profile")
    .update({ plan: "free", plan_expires_at: null })
    .eq("id", targetUserId);
  if (error) throw new HttpError(500, `revoke pro failed: ${error.message}`);
  await logGrant(adminUserId, targetUserId, "revoke_pro", { previous_plan: before.plan });
  return requireUserSummary(targetUserId);
}

export async function grantAdmin(adminUserId: string, targetUserId: string): Promise<AdminUserSummary> {
  await requireUserSummary(targetUserId);
  const { error } = await supabase().from("users_profile").update({ is_admin: true }).eq("id", targetUserId);
  if (error) throw new HttpError(500, `grant admin failed: ${error.message}`);
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
  const { error } = await supabase().from("users_profile").update({ is_admin: false }).eq("id", targetUserId);
  if (error) throw new HttpError(500, `revoke admin failed: ${error.message}`);
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
