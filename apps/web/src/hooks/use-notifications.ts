import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationClearAllResponseSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: () => api.get("/api/v1/notifications", notificationListResponseSchema),
    refetchInterval: 60_000,
  });
}

export function useNotificationAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "read" | "dismiss" }) =>
      api.post(`/api/v1/notifications/${id}/${action}`, notificationResponseSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}

/** Dismiss every nudge currently in the bell in one action. */
export function useClearNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/v1/notifications/clear-all", notificationClearAllResponseSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
