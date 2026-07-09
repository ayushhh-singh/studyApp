import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  answerSessionDetailResponseSchema,
  answerSessionResponseSchema,
  answerSessionResultResponseSchema,
} from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Start-or-resume is a genuinely idempotent POST (the backend returns the
 * existing in-progress session for this (user, test) if one exists) — modeled
 * as a query, not a mutation, specifically so it survives a component
 * remount. A mutation fired from a mount effect can race an early
 * lazy-route/StrictMode remount: the in-flight request resolves fine, but
 * the (now-unmounted) mutation instance's onSuccess/state update is silently
 * discarded, and the fresh remounted instance never re-fires because its own
 * ref guard already looks "started" from its own first effect run — the net
 * effect is the request completes server-side but the UI hangs forever. A
 * query's cache-by-key + retry-on-remount semantics don't have this failure
 * mode.
 */
export function useStartAnswerSession(testId: string | undefined) {
  return useQuery({
    queryKey: ["answer-sessions", "start", testId ?? ""],
    queryFn: () => api.post("/api/v1/answer-sessions", answerSessionResponseSchema, { test_id: testId }),
    enabled: !!testId,
    retry: false,
    staleTime: Infinity,
  });
}

export function useAnswerSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.answerSession(sessionId ?? ""),
    queryFn: () => api.get(`/api/v1/answer-sessions/${sessionId}`, answerSessionDetailResponseSchema),
    enabled: !!sessionId,
  });
}

export function useFinishAnswerSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post(`/api/v1/answer-sessions/${sessionId}/finish`, answerSessionResponseSchema),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.answerSession(session.id) });
    },
  });
}

export function useAnswerSessionResult(sessionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.answerSessionResult(sessionId ?? ""),
    queryFn: () => api.get(`/api/v1/answer-sessions/${sessionId}/result`, answerSessionResultResponseSchema),
    enabled: !!sessionId,
  });
}
