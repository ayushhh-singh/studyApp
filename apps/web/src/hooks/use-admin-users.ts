import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGrantLogResponseSchema,
  adminUserActionResponseSchema,
  adminUserAttemptsResponseSchema,
  adminUserListResponseSchema,
  adminUserStatsResponseSchema,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Every account, newest first, optionally narrowed by a query (email/display-name substring). */
export function useAdminUserList(page: number, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.adminUserList(page, trimmed),
    queryFn: () => api.get("/api/v1/admin/users", adminUserListResponseSchema, { page, query: trimmed || undefined }),
    placeholderData: (prev) => prev,
  });
}

/** The audit trail (grant_pro/revoke_pro/grant_admin/revoke_admin) for one target user. */
export function useAdminUserGrants(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.adminUserGrants(userId ?? ""),
    queryFn: () => api.get(`/api/v1/admin/users/${userId}/grants`, adminGrantLogResponseSchema),
    enabled: !!userId,
  });
}

/**
 * The drill-down's snapshot half: access state, activity, streak, SRS practice.
 * `enabled` on the id so a collapsed accordion row fires nothing — the panel is
 * only mounted for the expanded user, but the guard also covers the moment
 * between a row being clicked and its id landing in state.
 */
export function useAdminUserStats(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.adminUserStats(userId ?? ""),
    queryFn: () => api.get(`/api/v1/admin/users/${userId}/stats`, adminUserStatsResponseSchema),
    enabled: !!userId,
  });
}

/**
 * The drill-down's paginated test history. `placeholderData` keeps the previous
 * page visible while the next loads, matching useAdminUserList — a table that
 * blanks to a skeleton on every page turn reads as a reload, not a page change.
 */
export function useAdminUserAttempts(userId: string | undefined, page: number) {
  return useQuery({
    queryKey: queryKeys.adminUserAttempts(userId ?? "", page),
    queryFn: () => api.get(`/api/v1/admin/users/${userId}/attempts`, adminUserAttemptsResponseSchema, { page }),
    enabled: !!userId,
    placeholderData: (prev) => prev,
  });
}

function invalidateAfterAction(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  // The mutation response already carries the fresh summary, but the list
  // view (any page/query) may still show this user's stale plan/admin
  // badge — invalidate every cached list page plus this user's grant log.
  queryClient.invalidateQueries({ queryKey: ["admin", "users", "list"] });
  queryClient.invalidateQueries({ queryKey: queryKeys.adminUserGrants(userId) });
  // The drill-down snapshot embeds this user's plan/admin badges too, so a
  // grant/revoke leaves it stale in exactly the same way as the list row.
  queryClient.invalidateQueries({ queryKey: queryKeys.adminUserStats(userId) });
}

function useAdminUserAction(action: "revoke-pro" | "grant-admin" | "revoke-admin") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/v1/admin/users/${userId}/${action}`, adminUserActionResponseSchema),
    onSuccess: (_data, userId) => invalidateAfterAction(queryClient, userId),
  });
}

/**
 * Grant Pro access. `days` is optional — omit/null for an indefinite grant
 * (the only option that can never be misread as the 7-day signup trial; see
 * adminGrantProBodySchema's doc comment for the full caveat, surfaced in the
 * admin-users page's UI when it applies).
 */
export function useGrantPro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, days }: { userId: string; days: number | null }) =>
      api.post(`/api/v1/admin/users/${userId}/grant-pro`, adminUserActionResponseSchema, { days }),
    onSuccess: (_data, { userId }) => invalidateAfterAction(queryClient, userId),
  });
}
export function useRevokePro() {
  return useAdminUserAction("revoke-pro");
}
export function useGrantAdmin() {
  return useAdminUserAction("grant-admin");
}
export function useRevokeAdmin() {
  return useAdminUserAction("revoke-admin");
}
