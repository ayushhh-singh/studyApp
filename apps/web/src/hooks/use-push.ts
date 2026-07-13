import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { okResponseSchema, pushPreferencesResponseSchema, pushStatusResponseSchema, type PushPreferences } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { removePushSubscription, requestPushSubscription } from "@/lib/push-client";

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
      // removePushSubscription() both unsubscribes the browser's
      // PushSubscription AND returns its endpoint in one step — there is no
      // safe "fallback" endpoint to look up afterward: the browser subscription
      // is already gone by the time this returns, so a second lookup would
      // just find nothing (or, worse, tell the server to delete a row for an
      // endpoint the browser never actually unsubscribed, desyncing the two).
      // null means there was nothing to unsubscribe in the first place.
      const endpoint = await removePushSubscription();
      if (!endpoint) return;
      return api.post("/api/v1/push/unsubscribe", okResponseSchema, { endpoint });
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
