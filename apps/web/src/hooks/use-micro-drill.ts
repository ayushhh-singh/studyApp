import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  drillHistoryResponseSchema,
  drillRecommendationResponseSchema,
  drillSessionResponseSchema,
  type DrillType,
  type SubmitDrillResponsesBody,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Which drill type (if any) the learner should try next, from recent evaluation history. */
export function useDrillRecommendation() {
  return useQuery({
    queryKey: queryKeys.drillRecommendation(),
    queryFn: () => api.get("/api/v1/drills/recommendation", drillRecommendationResponseSchema),
  });
}

/** Last ~10 drill sessions (date, type, overall_pct). */
export function useDrillHistory() {
  return useQuery({
    queryKey: queryKeys.drillHistory(),
    queryFn: () => api.get("/api/v1/drills/history", drillHistoryResponseSchema),
  });
}

/** Starts a new drill session (3 items for the given rubric-focused type). */
export function useCreateDrill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (drill_type: DrillType) => api.post("/api/v1/drills", drillSessionResponseSchema, { drill_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.drillHistory() });
    },
  });
}

/** Saves the learner's 3 written responses before the SSE evaluate pass runs. */
export function useSubmitDrillResponses() {
  return useMutation({
    mutationFn: ({ id, responses }: { id: string; responses: SubmitDrillResponsesBody["responses"] }) =>
      api.patch(`/api/v1/drills/${id}/responses`, drillSessionResponseSchema, { responses }),
  });
}

/** Deletes a drill session from history. */
export function useDeleteDrill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/drills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.drillHistory() });
    },
  });
}
