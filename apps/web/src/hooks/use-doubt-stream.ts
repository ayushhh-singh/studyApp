import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale, MentorCitation } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface DoubtStreamState {
  phase: "retrieving" | "thinking" | "answering" | null;
  citations: MentorCitation[];
  weak: boolean;
  fromCache: boolean;
  answer: string;
  doneMessageId: string | null;
  error: string | null;
  isStreaming: boolean;
}

const INITIAL: DoubtStreamState = {
  phase: null,
  citations: [],
  weak: false,
  fromCache: false,
  answer: "",
  doneMessageId: null,
  error: null,
  isStreaming: false,
};

/**
 * Drives POST /stream/doubts/:threadId/messages. The same reducer handles a
 * live model stream (many delta chunks) and a FAQ-cache replay (one full delta),
 * since both just append to `answer`.
 */
export function useDoubtStream(threadId: string, locale: Locale) {
  const [state, setState] = useState<DoubtStreamState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const onDoneRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    (content: string, opts: { mode?: "normal" | "revision"; nodeId?: string; onDone?: () => void } = {}) => {
      controllerRef.current?.abort();
      onDoneRef.current = opts.onDone ?? null;
      setState({ ...INITIAL, isStreaming: true });
      controllerRef.current = streamEvents({
        url: `${API_URL}/api/v1/stream/doubts/${threadId}/messages?locale=${locale}`,
        method: "POST",
        body: { content, mode: opts.mode ?? "normal", ...(opts.nodeId ? { node_id: opts.nodeId } : {}) },
        onEvent: (event, data) => {
          setState((prev) => {
            switch (event) {
              case "status":
                return { ...prev, phase: (data as { phase: DoubtStreamState["phase"] }).phase };
              case "citations": {
                const d = data as { citations: MentorCitation[]; weak: boolean };
                return { ...prev, citations: d.citations, weak: d.weak };
              }
              case "source":
                return { ...prev, fromCache: (data as { from_cache: boolean }).from_cache };
              case "delta":
                return { ...prev, answer: prev.answer + (data as { text: string }).text };
              case "done":
                return { ...prev, doneMessageId: (data as { message_id: string }).message_id, isStreaming: false, phase: null };
              case "error":
                return { ...prev, error: (data as { message: string }).message, isStreaming: false, phase: null };
              default:
                return prev;
            }
          });
          if (event === "done") onDoneRef.current?.();
        },
        onError: (err) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            phase: null,
            error: prev.error ?? (err instanceof Error ? err.message : "The mentor couldn't answer. Try again."),
          }));
        },
      });
    },
    [threadId, locale],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(INITIAL);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, send, reset };
}
