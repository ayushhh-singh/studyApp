/**
 * Sukoon F8 check-in data hooks — TanStack Query over /api/sukoon/checkins.
 * Mirrors use-sukoon-mood.ts conventions.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonCheckinStatusResponseSchema,
  sukoonCheckinSubmitResponseSchema,
  sukoonCheckinTrendResponseSchema,
  type SukoonCheckinSubmitBody,
  type SukoonCheckinType,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCheckinStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonCheckinStatus(),
    queryFn: () => api.get("/api/sukoon/checkins/status", sukoonCheckinStatusResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useCheckinTrend(type: SukoonCheckinType, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonCheckinTrend(type),
    queryFn: () =>
      api.get("/api/sukoon/checkins/trend", sukoonCheckinTrendResponseSchema, { type }),
    enabled: options?.enabled ?? true,
  });
}

export function useSubmitCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SukoonCheckinSubmitBody) =>
      api.post("/api/sukoon/checkins", sukoonCheckinSubmitResponseSchema, body),
    onSuccess: () => {
      // Refresh status (last-taken / due) + every trend chart after a new check-in.
      void queryClient.invalidateQueries({ queryKey: ["sukoon", "checkins"] });
    },
  });
}
