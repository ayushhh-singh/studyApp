import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activityHeatmapResponseSchema,
  leaderboardResponseSchema,
  milestoneListResponseSchema,
  milestoneResponseSchema,
  weeklyDigestResponseSchema,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useWeeklyDigest() {
  return useQuery({
    queryKey: queryKeys.weeklyDigest(),
    queryFn: () => api.get("/api/v1/digest/weekly", weeklyDigestResponseSchema),
  });
}

/** Activity heatmap incl. Perfect Days for the dashboard. */
export function useActivityHeatmap(weeks?: number) {
  return useQuery({
    queryKey: queryKeys.activityHeatmap(weeks ?? 13),
    queryFn: () => api.get("/api/v1/engagement/heatmap", activityHeatmapResponseSchema, { weeks }),
  });
}

/** Unseen milestones (drive the toasts). Polled so a milestone earned mid-session surfaces. */
export function useMilestones() {
  return useQuery({
    queryKey: queryKeys.milestones(),
    queryFn: () => api.get("/api/v1/milestones", milestoneListResponseSchema),
    refetchInterval: 120_000,
  });
}

export function useMarkMilestoneSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/milestones/${id}/seen`, milestoneResponseSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.milestones() }),
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard(),
    queryFn: () => api.get("/api/v1/leaderboard", leaderboardResponseSchema),
  });
}
