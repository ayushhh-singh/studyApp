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
  // See useEvaluationStream's identical guard: React StrictMode's dev-mode
  // double-invoke of the mount effect otherwise opens two concurrent SSE
  // connections for the same replay, duplicating the accumulated
  // transcription text. An explicit retry (force: true) always reopens.
  const startedIdRef = useRef<string | null>(null);
  // Monotonic id for the CURRENT connection attempt — see
  // useEvaluationStream's identical field for the full explanation. Short
  // version: controller.signal.aborted is NOT a reliable "is this stale"
  // check, because sse.ts's streamEvents() awaits getAccessToken() before
  // ever calling fetchEventSource(), and an abort() during that gap doesn't
  // cancel the real request (fetchEventSource only wires up an abort
  // listener once it actually runs) — it just gets marked aborted on our
  // side while the underlying request runs on as a "zombie". React
  // StrictMode's mount->cleanup->mount dance hits this exactly and, without
  // this generation check, would leave the hook silently swallowing a
  // genuine transcription failure — stuck on the streaming spinner forever
  // with no retry option, since the guard above blocks a real replacement
  // connection from opening for the same submissionId.
  const generationRef = useRef(0);

  const start = useCallback((opts?: { force?: boolean }) => {
    if (!opts?.force && startedIdRef.current === submissionId) return;
    startedIdRef.current = submissionId;
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    setState({ ...INITIAL_STATE, isStreaming: true });
    controllerRef.current = streamEvents({
      url: `${API_URL}/api/v1/stream/ocr/${submissionId}`,
      onEvent: (event, data) => {
        if (generation !== generationRef.current) return; // superseded by a newer connection — ignore
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
        if (generation !== generationRef.current) return; // superseded — the current connection owns error state now
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: prev.error ?? (err instanceof Error ? err.message : "Transcription stream failed"),
        }));
      },
    });
  }, [submissionId]);

  // See useEvaluationStream's identical cleanup for the full writeup of a
  // real (but DEV-ONLY, StrictMode-specific) gap this abort() can fall into:
  // it can be silently ineffective against the underlying request (a
  // "zombie" connection), which then silently swallows a genuine later
  // failure instead of surfacing it. Deliberately not "fixed" by resetting
  // startedIdRef here — that trades the rare hang for a rare spurious error
  // (a genuine replacement connection racing the still-alive zombie for
  // whatever server-side lock/limit applies) rather than a clean win, and
  // the actually-clean fix belongs in sse.ts, outside this task's scope.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
