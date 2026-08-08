import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StudyPlan } from "@neev/shared";
import { SseError, streamEvents } from "@/lib/sse";
import { queryKeys } from "@/lib/query-keys";

const API_URL = import.meta.env.VITE_API_URL as string;

// Fallback when a 429 carries no (or a malformed) Retry-After header — should
// only happen for a rate-limit source other than lib/rate-limit.ts's
// rateLimit(), which always sets one. Matches this endpoint's rate-limit window.
const DEFAULT_COOLDOWN_SECONDS = 60;

export interface StudyPlanStreamState {
  stage: string | null;
  plan: StudyPlan | null;
  error: string | null;
  /** Set only when the pre-flight was rejected with a 429 — the card renders
   * a friendly countdown from this instead of the generic `error` message. */
  cooldownSeconds: number | null;
  isStreaming: boolean;
}

const INITIAL_STATE: StudyPlanStreamState = {
  stage: null,
  plan: null,
  error: null,
  cooldownSeconds: null,
  isStreaming: false,
};

/**
 * Drives POST /stream/study-plan/generate — same reducer-over-SSE-events shape
 * as use-evaluation-stream.ts/use-drill-stream.ts. On `done` the fresh plan is
 * written straight into the `activePlan` query cache so the page re-renders
 * without a second round-trip.
 */
export function useStudyPlanStream() {
  const [state, setState] = useState<StudyPlanStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const start = useCallback(
    (hoursPerDay: number) => {
      controllerRef.current?.abort();
      setState({ ...INITIAL_STATE, isStreaming: true });
      controllerRef.current = streamEvents({
        url: `${API_URL}/api/v1/stream/study-plan/generate`,
        method: "POST",
        body: { hours_per_day: hoursPerDay },
        onEvent: (event, data) => {
          setState((prev) => {
            switch (event) {
              case "status":
                return { ...prev, stage: (data as { stage: string }).stage };
              case "done": {
                const plan = (data as { plan: StudyPlan }).plan;
                queryClient.setQueryData(queryKeys.activePlan(), { plan, can_regenerate_today: false });
                return { ...prev, plan, isStreaming: false };
              }
              case "error":
                return { ...prev, error: (data as { message: string }).message, isStreaming: false };
              default:
                return prev;
            }
          });
        },
        onError: (err) => {
          const rateLimited = err instanceof SseError && err.status === 429;
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            cooldownSeconds: rateLimited ? (err.retryAfterSeconds ?? DEFAULT_COOLDOWN_SECONDS) : null,
            // A rate-limit hit is shown via cooldownSeconds instead, not as a
            // generic error — keep whatever pipeline-level `error` (from the
            // "error" SSE event above) was already set, same as before.
            error: rateLimited ? prev.error : (prev.error ?? (err instanceof Error ? err.message : "Study plan generation failed")),
          }));
        },
      });
    },
    [queryClient],
  );

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
