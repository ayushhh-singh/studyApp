import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { okResponseSchema, pushPreferencesResponseSchema, pushStatusResponseSchema, type PushPreferences } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { currentPushEndpoint, removePushSubscription, requestPushSubscription } from "@/lib/push-client";

export function usePushStatus() {
  return useQuery({
    queryKey: queryKeys.pushStatus(),
    queryFn: () => api.get("/api/v1/push/status", pushStatusResponseSchema),
  });
}

export function useEnablePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const payload = await requestPushSubscription();
      if (!payload) throw new Error("permission_denied");
      return api.post("/api/v1/push/subscribe", okResponseSchema, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.pushStatus() }),
  });
}

export function useDisablePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const endpoint = await removePushSubscription();
      if (!endpoint) {
        const fallback = await currentPushEndpoint();
        if (!fallback) return;
      }
      return api.post("/api/v1/push/unsubscribe", okResponseSchema, { endpoint: endpoint ?? (await currentPushEndpoint()) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.pushStatus() }),
  });
}

export function useUpdatePushPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PushPreferences>) => api.patch("/api/v1/push/preferences", pushPreferencesResponseSchema, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.pushStatus() }),
  });
}
