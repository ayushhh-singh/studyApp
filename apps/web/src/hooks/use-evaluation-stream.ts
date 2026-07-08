import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisEvent, DimensionScoreEvent, EvalDoneEvent, EvalStatusPhase } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface EvaluationStreamState {
  phase: EvalStatusPhase | null;
  dimensions: DimensionScoreEvent[];
  analysis: AnalysisEvent | null;
  strengths: string;
  improvements: string;
  modelAnswer: string;
  done: EvalDoneEvent | null;
  error: string | null;
  isStreaming: boolean;
}

const INITIAL_STATE: EvaluationStreamState = {
  phase: null,
  dimensions: [],
  analysis: null,
  strengths: "",
  improvements: "",
  modelAnswer: "",
  done: null,
  error: null,
  isStreaming: false,
};

/**
 * Drives GET /stream/evaluations/:submissionId. The same reducer handles both
 * a live run (many small feedback_delta/model_answer_delta chunks) and a
 * replay (each arrives as one full-text event) — both just append to the
 * accumulated string, so no branching is needed for either case.
 */
export function useEvaluationStream(submissionId: string) {
  const [state, setState] = useState<EvaluationStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    controllerRef.current?.abort();
    setState({ ...INITIAL_STATE, isStreaming: true });
    controllerRef.current = streamEvents({
      url: `${API_URL}/api/v1/stream/evaluations/${submissionId}`,
      onEvent: (event, data) => {
        setState((prev) => {
          switch (event) {
            case "status":
              return { ...prev, phase: (data as { phase: EvalStatusPhase }).phase };
            case "dimension_score": {
              // Idempotent by dimension key: a replay (or a re-run stream, e.g.
              // React StrictMode invoking the effect twice in dev) re-emits all
              // six, so replace-or-append rather than blindly accumulating.
              const dim = data as DimensionScoreEvent;
              const existing = prev.dimensions.findIndex((d) => d.key === dim.key);
              if (existing === -1) return { ...prev, dimensions: [...prev.dimensions, dim] };
              const next = prev.dimensions.slice();
              next[existing] = dim;
              return { ...prev, dimensions: next };
            }
            case "analysis":
              return { ...prev, analysis: data as AnalysisEvent };
            case "feedback_delta": {
              const { section, text } = data as { section: "strengths" | "improvements"; text: string };
              return section === "strengths"
                ? { ...prev, strengths: prev.strengths + text }
                : { ...prev, improvements: prev.improvements + text };
            }
            case "model_answer_delta":
              return { ...prev, modelAnswer: prev.modelAnswer + (data as { text: string }).text };
            case "done":
              return { ...prev, done: data as EvalDoneEvent, isStreaming: false };
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
          error: prev.error ?? (err instanceof Error ? err.message : "Evaluation stream failed"),
        }));
      },
    });
  }, [submissionId]);

  // Abort an in-flight stream on unmount (e.g. navigating away mid-evaluation)
  // so the server-side sonnet calls it's driving stop billing tokens.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
