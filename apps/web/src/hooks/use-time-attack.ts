import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimeAttackPaperCode } from "@prayasup/shared";
import {
  timeAttackResultResponseSchema,
  timeAttackStartResponseSchema,
  timeAttackTopicsResponseSchema,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useTimeAttackTopics(paper: TimeAttackPaperCode) {
  return useQuery({
    queryKey: queryKeys.timeAttackTopics(paper),
    queryFn: () => api.get("/api/v1/time-attack/topics", timeAttackTopicsResponseSchema, { paper }),
  });
}

export function useStartTimeAttack() {
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post("/api/v1/time-attack", timeAttackStartResponseSchema, { node_id: nodeId }),
  });
}

export function useFinishTimeAttack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, comboBest }: { attemptId: string; comboBest: number }) =>
      api.post(`/api/v1/time-attack/${attemptId}/finish`, timeAttackResultResponseSchema, { combo_best: comboBest }),
    // Refresh personal bests on the topic picker after a run — invalidate by
    // prefix (no paper arg) so both the GS-I and CSAT caches refresh, not just
    // whichever paper is currently selected.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["time-attack", "topics"] }),
  });
}
