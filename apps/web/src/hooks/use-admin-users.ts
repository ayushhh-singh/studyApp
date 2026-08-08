import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminGrantLogResponseSchema,
  adminUserActionResponseSchema,
  adminUserSearchResponseSchema,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Search for one account by exact email. Disabled until a non-empty email is given. */
export function useAdminUserSearch(email: string) {
  const trimmed = email.trim();
  return useQuery({
    queryKey: queryKeys.adminUserSearch(trimmed),
    queryFn: () => api.get("/api/v1/admin/users/search", adminUserSearchResponseSchema, { email: trimmed }),
    enabled: trimmed.length > 0,
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
      // The mutation response already carries the fresh summary, but a caller
      // may still be showing a search-result view keyed by email — invalidate
      // both that and this user's grant log so neither goes stale.
      queryClient.invalidateQueries({ queryKey: ["admin", "users", "search"] });
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
