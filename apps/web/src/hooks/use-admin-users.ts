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

function useAdminUserAction(action: "grant-pro" | "revoke-pro" | "grant-admin" | "revoke-admin") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/v1/admin/users/${userId}/${action}`, adminUserActionResponseSchema),
    onSuccess: (_data, userId) => {
      // The mutation response already carries the fresh summary, but the list
      // view (any page/query) may still show this user's stale plan/admin
      // badge — invalidate every cached list page plus this user's grant log.
      queryClient.invalidateQueries({ queryKey: ["admin", "users", "list"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminUserGrants(userId) });
    },
  });
}

export function useGrantPro() {
  return useAdminUserAction("grant-pro");
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
