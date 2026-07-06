import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationListResponseSchema, notificationResponseSchema } from "@prayasup/shared";
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
