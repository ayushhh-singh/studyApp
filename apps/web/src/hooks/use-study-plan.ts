import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activePlanResponseSchema,
  studyPlanResponseSchema,
  type ActivePlanState,
  type ToggleTaskBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The learner's current weekly AI study plan, if one has been generated. */
export function useActivePlan() {
  return useQuery({
    queryKey: queryKeys.activePlan(),
    queryFn: () => api.get("/api/v1/study-plan", activePlanResponseSchema),
  });
}

/** Toggles a single task's done state; merges the returned plan back into the cache. */
export function useToggleTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ToggleTaskBody) => api.patch("/api/v1/study-plan/tasks", studyPlanResponseSchema, body),
    onSuccess: (plan) => {
      queryClient.setQueryData(queryKeys.activePlan(), (prev: ActivePlanState | undefined) => ({
        plan,
        can_regenerate_today: prev?.can_regenerate_today ?? false,
      }));
    },
  });
}
