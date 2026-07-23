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

/**
 * Removes one task from a plan day. Optimistic: the row disappears the
 * instant you click (no round-trip wait), rolled back on failure — a delete
 * is low-stakes here (the whole plan can always be regenerated) so instant
 * feedback matters more than waiting for server confirmation.
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, taskId }: { date: string; taskId: string }) =>
      api.delete(`/api/v1/study-plan/days/${date}/tasks/${taskId}`),
    onMutate: async ({ date, taskId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activePlan() });
      const previous = queryClient.getQueryData<ActivePlanState>(queryKeys.activePlan());
      queryClient.setQueryData(queryKeys.activePlan(), (prev: ActivePlanState | undefined) =>
        !prev?.plan
          ? prev
          : {
              ...prev,
              plan: {
                ...prev.plan,
                days: prev.plan.days.map((d) =>
                  d.date === date ? { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) } : d,
                ),
              },
            },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.activePlan(), context.previous);
    },
  });
}

/** Removes a whole day (and its tasks) from a plan. Optimistic, same rationale as useDeleteTask. */
export function useDeleteDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.delete(`/api/v1/study-plan/days/${date}`),
    onMutate: async (date) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activePlan() });
      const previous = queryClient.getQueryData<ActivePlanState>(queryKeys.activePlan());
      queryClient.setQueryData(queryKeys.activePlan(), (prev: ActivePlanState | undefined) =>
        !prev?.plan ? prev : { ...prev, plan: { ...prev.plan, days: prev.plan.days.filter((d) => d.date !== date) } },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.activePlan(), context.previous);
    },
  });
}
