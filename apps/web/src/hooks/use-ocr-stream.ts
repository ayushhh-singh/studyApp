import { useCallback, useEffect, useRef, useState } from "react";
import type { OcrDoneEvent } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface OcrStreamState {
  text: string;
  done: OcrDoneEvent | null;
  error: string | null;
  isStreaming: boolean;
}

const INITIAL_STATE: OcrStreamState = { text: "", done: null, error: null, isStreaming: false };

/**
 * Drives GET /stream/ocr/:submissionId — the transcription half of the
 * handwritten trust loop. Mirrors useEvaluationStream's shape: a replay
 * arrives as a single "done" with no preceding delta events, a live run
 * streams the transcription in as it's produced.
 */
export function useOcrStream(submissionId: string) {
  const [state, setState] = useState<OcrStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    controllerRef.current?.abort();
    setState({ ...INITIAL_STATE, isStreaming: true });
    controllerRef.current = streamEvents({
      url: `${API_URL}/api/v1/stream/ocr/${submissionId}`,
      onEvent: (event, data) => {
        setState((prev) => {
          switch (event) {
            case "delta":
              return { ...prev, text: prev.text + (data as { text: string }).text };
            case "done": {
              const done = data as OcrDoneEvent;
              return { ...prev, text: prev.text || done.ocr_text, done, isStreaming: false };
            }
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
          error: prev.error ?? (err instanceof Error ? err.message : "Transcription stream failed"),
        }));
      },
    });
  }, [submissionId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
