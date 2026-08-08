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
import type {
  AdminGrantAction,
  AdminUserAttempt,
  AdminUserCost,
  AdminUserCostPurpose,
  AdminUserListRow,
  AdminUserStats,
  AdminUserSummary,
  TargetExamCode,
} from "@neev/shared";
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { priceLlmCall, type PriceableLlmCall } from "../lib/llm-cost.js";
import { selectAll } from "../lib/paginate.js";
import { listAttempts } from "./attempts.js";
import { getStats } from "./srs.js";

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
  streak_count: number;
}

const PROFILE_COLUMNS =
  "display_name, plan, plan_expires_at, has_used_trial, is_admin, target_exam, created_at, streak_count";

/** One row of `admin_user_activity` (migration 0119). */
export interface UserActivityRow {
  user_id: string;
  last_active_at: string | null;
  tests_taken: number;
  srs_reviews_count: number;
}

/**
 * Batched activity for a set of users, via the `admin_user_activity` aggregate
 * (migration 0119 — see that file for why this is a SQL function rather than
 * PostgREST calls, and why "active" spans five tables).
 *
 * The RPC returns exactly one row per requested id, so a user with no activity
 * at all still gets an entry and renders as "never active" rather than
 * disappearing. Chunked at 100 ids on the same reasoning as
 * `loadProfilesByIds`' `.in()` chunking — a large array in the request body is
 * fine, but keeping both reads to the same batch size keeps the shape uniform.
 */
export async function loadActivityByIds(ids: string[]): Promise<Map<string, UserActivityRow>> {
  const map = new Map<string, UserActivityRow>();
  if (ids.length === 0) return map;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase().rpc("admin_user_activity", { p_user_ids: chunk });
    if (error) throw new HttpError(500, `activity lookup failed: ${error.message}`);
    for (const row of (data ?? []) as UserActivityRow[]) map.set(row.user_id, row);
  }
  return map;
}

/** Page size for the "all users" list — mirrors REVIEW_PAGE_SIZE's convention. */
export const ADMIN_USER_LIST_PAGE_SIZE = 20;

function buildSummary(authUser: AuthUserLike, profile: ProfileRow | undefined): AdminUserSummary {
  return {
    id: authUser.id,
    // `|| null`, NOT `?? null`: GoTrue returns an EMPTY STRING (not null) for an
    // anonymous user's email — measured, 21 of 97 accounts here. `??` only
    // catches null/undefined, so "" survived to the UI and rendered as a blank
    // line where the row's `email ?? t("noEmail")` fallback should have said
    // "No email". Normalised here rather than at the render site so every
    // consumer of AdminUserSummary gets a real null.
    email: authUser.email || null,
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
export async function listUsers(opts: { page: number; query?: string }): Promise<{ items: AdminUserListRow[]; total: number }> {
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
  const pageSummaries = summaries.slice(from, from + ADMIN_USER_LIST_PAGE_SIZE);

  // Activity is loaded for the SLICED PAGE ONLY (<= ADMIN_USER_LIST_PAGE_SIZE
  // ids), never for every account: it aggregates five tables, so pricing it per
  // page keeps this endpoint's cost flat as the user count grows. This is also
  // why the slice happens before the lookup rather than after.
  const activityById = await loadActivityByIds(pageSummaries.map((s) => s.id));
  const items: AdminUserListRow[] = pageSummaries.map((s) => {
    const activity = activityById.get(s.id);
    return {
      ...s,
      last_active_at: activity?.last_active_at ?? null,
      tests_taken: activity?.tests_taken ?? 0,
      srs_reviews_count: activity?.srs_reviews_count ?? 0,
      streak_count: profilesById.get(s.id)?.streak_count ?? 0,
    };
  });
  return { items, total };
}

/**
 * The drill-down's non-paginated half: identity + access + activity + streak +
 * SRS practice for ONE account.
 *
 * `getStats` is the user's OWN `GET /srs/stats` service function, called
 * verbatim so an admin and the student cannot read different revision figures.
 * Its 7-day forecast is dropped from the response (see the shared schema's note)
 * — the computation is reused, only the payload is trimmed.
 */
export async function getUserStats(userId: string): Promise<AdminUserStats> {
  // Confirms the AUTH user exists and 404s if not, before doing any of the work.
  const summary = await requireUserSummary(userId);

  const [profile, activityById, srs] = await Promise.all([
    supabase()
      .from("users_profile")
      .select("streak_count, streak_freezes, streak_freeze_used_on, last_active_date")
      .eq("id", userId)
      .maybeSingle(),
    loadActivityByIds([userId]),
    getStats(userId),
  ]);
  if (profile.error) throw new HttpError(500, `profile lookup failed: ${profile.error.message}`);
  const streakRow = (profile.data ?? null) as {
    streak_count: number;
    streak_freezes: number;
    streak_freeze_used_on: string | null;
    last_active_date: string | null;
  } | null;
  const activity = activityById.get(userId);

  return {
    user: {
      ...summary,
      last_active_at: activity?.last_active_at ?? null,
      tests_taken: activity?.tests_taken ?? 0,
      srs_reviews_count: activity?.srs_reviews_count ?? 0,
      streak_count: streakRow?.streak_count ?? 0,
    },
    streak: {
      streak_count: streakRow?.streak_count ?? 0,
      streak_freezes: streakRow?.streak_freezes ?? 0,
      streak_freeze_used_on: streakRow?.streak_freeze_used_on ?? null,
      last_active_date: streakRow?.last_active_date ?? null,
    },
    srs: {
      total_cards: srs.total_cards,
      due_today: srs.due_today,
      reviewed_today: srs.reviewed_today,
      retention_pct: srs.retention_pct,
    },
  };
}

/**
 * The drill-down's paginated test history.
 *
 * `listAttempts` is reused UNCHANGED — and it is safe to point at another user
 * because it takes the target user id and resolves that user's OWN exam via
 * `getUserExam(userId)`, so an admin sees the history scoped exactly as the
 * student would see it, not as the admin's own exam.
 *
 * Ranks are attached from `admin_user_test_ranks` (0121, corrected by 0122),
 * which mirrors `getTestBoard` so the number matches the student's scoreboard.
 * Most rows have NO rank — see the shared schema's note. The RPC is fetched once
 * for the whole user, not per row: it is set-based and small (one entry per
 * ranked attempt), and a per-row lookup would be a query per attempt.
 *
 * ⚑ KEYED BY attempt_id, NOT test_id. `mv_test_leaderboard` ranks only each
 * user's FIRST non-ghost attempt per test, so a test_id key would attach that
 * rank to every LATER attempt on the same test too — showing a re-attempt a
 * standing it never earned, and defeating the first-attempt-only rule 0067
 * exists to enforce. Every unranked attempt correctly resolves to null.
 */
export async function listUserAttempts(
  userId: string,
  page: number,
): Promise<{ items: AdminUserAttempt[]; total: number }> {
  await requireUserSummary(userId);

  const [{ items, total }, ranks] = await Promise.all([
    listAttempts(userId, page),
    supabase().rpc("admin_user_test_ranks", { p_user_id: userId }),
  ]);
  if (ranks.error) throw new HttpError(500, `rank lookup failed: ${ranks.error.message}`);
  const rankByAttempt = new Map<string, { user_rank: number; cohort_size: number }>();
  for (const row of (ranks.data ?? []) as { attempt_id: string; user_rank: number; cohort_size: number }[]) {
    rankByAttempt.set(row.attempt_id, { user_rank: row.user_rank, cohort_size: row.cohort_size });
  }

  return {
    items: items.map((a) => {
      const rank = rankByAttempt.get(a.id);
      return { ...a, user_rank: rank?.user_rank ?? null, cohort_size: rank?.cohort_size ?? null };
    }),
    total,
  };
}

/**
 * Per-user LLM cost, rolled up from real `llm_calls` rows.
 *
 * Pricing goes through `priceLlmCall` — the same module `cost:report`'s
 * `isModelId` now comes from — so the admin surface and the ops report cannot
 * disagree about what a call cost or which rows are priceable. No pricing math
 * is reimplemented here.
 *
 * PAGED via `selectAll`: a heavy user's row count is unbounded, and an unranged
 * select would silently truncate at PostgREST's 1000-row cap and UNDERSTATE the
 * bill — the failure mode this repo has hit repeatedly, and the worst possible
 * one for a cost figure, since a truncated total looks entirely plausible.
 *
 * ⚑ ORDERED BY (created_at, id), NOT created_at ALONE. `selectAll` pages with
 * `.range()`, which is only correct over a TOTAL order: with a non-unique sort
 * key Postgres may order tied rows differently between page requests, so a row
 * can be skipped or counted twice across the boundary — silently wrong, in
 * either direction, on a money figure. `created_at` is not unique in principle
 * (nothing stops two calls sharing a timestamp, and batch paths insert together),
 * so `id` (the primary key) is appended as the tiebreaker to make the order
 * total. Measured today: all 282 attributable rows have distinct timestamps and
 * the heaviest single user has 34 calls, so paging never even engages — this is
 * a latent correctness fix, not a live one. The ASC order also makes
 * `rows[0]`/`rows[last]` the true first/last call by time.
 *
 * The `(user_id, created_at desc)` index from 0021 covers this filter.
 */
export async function getUserCost(userId: string): Promise<AdminUserCost> {
  await requireUserSummary(userId);

  const rows = await selectAll<PriceableLlmCall & { purpose: string }>(() =>
    supabase()
      .from("llm_calls")
      .select("purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, meta, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  const byPurpose = new Map<string, AdminUserCostPurpose>();
  let totalCost = 0;
  let unpriced = 0;
  for (const row of rows) {
    const cost = priceLlmCall(row);
    if (cost === null) unpriced++;
    const entry = byPurpose.get(row.purpose) ?? {
      purpose: row.purpose,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    };
    entry.calls++;
    entry.input_tokens += row.input_tokens;
    entry.output_tokens += row.output_tokens;
    entry.cost_usd += cost ?? 0;
    byPurpose.set(row.purpose, entry);
    totalCost += cost ?? 0;
  }

  return {
    total_cost_usd: totalCost,
    total_calls: rows.length,
    by_purpose: [...byPurpose.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    // Rows are fetched created_at ASC, so the ends of the array are the bounds.
    first_call_at: rows[0]?.created_at ?? null,
    last_call_at: rows[rows.length - 1]?.created_at ?? null,
    unpriced_calls: unpriced,
  };
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
