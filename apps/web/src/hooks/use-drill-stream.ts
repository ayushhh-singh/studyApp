import { useCallback, useEffect, useRef, useState } from "react";
import type { BilingualText, DrillSession } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface DrillItemScoreEvent {
  question_id: string;
  score: number;
  justification_i18n: BilingualText;
}

export interface DrillStreamState {
  stage: string | null;
  itemScores: DrillItemScoreEvent[];
  session: DrillSession | null;
  error: string | null;
  isStreaming: boolean;
}

const INITIAL_STATE: DrillStreamState = {
  stage: null,
  itemScores: [],
  session: null,
  error: null,
  isStreaming: false,
};

/**
 * Drives GET /stream/drills/:id/evaluate — same reducer-over-SSE-events shape
 * as use-evaluation-stream.ts. Three `item_score` events arrive (one per drill
 * item) followed by a `done` carrying the final, status="complete" session.
 */
export function useDrillStream(drillId: string) {
  const [state, setState] = useState<DrillStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    controllerRef.current?.abort();
    setState({ ...INITIAL_STATE, isStreaming: true });
    controllerRef.current = streamEvents({
      url: `${API_URL}/api/v1/stream/drills/${drillId}/evaluate`,
      onEvent: (event, data) => {
        setState((prev) => {
          switch (event) {
            case "status":
              return { ...prev, stage: (data as { stage: string }).stage };
            case "item_score":
              return { ...prev, itemScores: [...prev.itemScores, data as DrillItemScoreEvent] };
            case "done":
              return { ...prev, session: (data as { session: DrillSession }).session, isStreaming: false };
            case "error":
              return { ...prev, error: (data as { message: string }).message, isStreaming: false };
            default:
              return prev;
          }
        });
      },
      onError: (err) => {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: prev.error ?? (err instanceof Error ? err.message : "Drill scoring stream failed"),
        }));
      },
    });
  }, [drillId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
