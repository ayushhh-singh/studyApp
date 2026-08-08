import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGrantLogResponseSchema,
  adminUserActionResponseSchema,
  adminUserListResponseSchema,
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

function invalidateAfterAction(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  // The mutation response already carries the fresh summary, but the list
  // view (any page/query) may still show this user's stale plan/admin
  // badge — invalidate every cached list page plus this user's grant log.
  queryClient.invalidateQueries({ queryKey: ["admin", "users", "list"] });
  queryClient.invalidateQueries({ queryKey: queryKeys.adminUserGrants(userId) });
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
