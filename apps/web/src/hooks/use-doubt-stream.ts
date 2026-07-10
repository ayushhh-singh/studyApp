import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Locale,
  MentorCitation,
  MentorContinueNode,
  MentorDepth,
  MentorPyqRef,
  MentorQuizQuestion,
  MentorWebSource,
} from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface DoubtStreamState {
  phase: "retrieving" | "researching" | "thinking" | "answering" | "wrapping_up" | null;
  citations: MentorCitation[];
  weak: boolean;
  fromCache: boolean;
  /** A "from a similar doubt" (0.86–0.95) reply — shows the notice + "Answer fresh". */
  similar: boolean;
  answer: string;
  doneMessageId: string | null;
  error: string | null;
  isStreaming: boolean;
  // --- teacher mode extras ---
  teacher: boolean;
  depth: MentorDepth | null;
  webSources: MentorWebSource[];
  relatedPyqs: MentorPyqRef[];
  quickCheck: MentorQuizQuestion[];
  continueWith: MentorContinueNode[];
}

const INITIAL: DoubtStreamState = {
  phase: null,
  citations: [],
  weak: false,
  fromCache: false,
  similar: false,
  answer: "",
  doneMessageId: null,
  error: null,
  isStreaming: false,
  teacher: false,
  depth: null,
  webSources: [],
  relatedPyqs: [],
  quickCheck: [],
  continueWith: [],
};

export interface SendOptions {
  mode?: "normal" | "revision";
  teach?: boolean;
  depth?: MentorDepth;
  nodeId?: string;
  /** "Answer fresh" — skip the FAQ cache and regenerate (updates the cached entry). */
  bypassCache?: boolean;
  onDone?: () => void;
}

/**
 * Drives POST /stream/doubts/:threadId/messages. The same reducer handles a
 * live model stream (many delta chunks), a FAQ-cache replay (one full delta),
 * and a teacher lesson (prose deltas + structured extra events).
 */
export function useDoubtStream(threadId: string, locale: Locale) {
  const [state, setState] = useState<DoubtStreamState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const onDoneRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    (content: string, opts: SendOptions = {}) => {
      controllerRef.current?.abort();
      onDoneRef.current = opts.onDone ?? null;
      setState({ ...INITIAL, isStreaming: true, teacher: opts.teach ?? false });
      controllerRef.current = streamEvents({
        url: `${API_URL}/api/v1/stream/doubts/${threadId}/messages?locale=${locale}`,
        method: "POST",
        body: {
          content,
          mode: opts.mode ?? "normal",
          teach: opts.teach ?? false,
          depth: opts.depth ?? "standard",
          bypass_cache: opts.bypassCache ?? false,
          ...(opts.nodeId ? { node_id: opts.nodeId } : {}),
        },
        onEvent: (event, data) => {
          setState((prev) => {
            switch (event) {
              case "status":
                return { ...prev, phase: (data as { phase: DoubtStreamState["phase"] }).phase };
              case "teacher": {
                const d = data as { depth: MentorDepth; node_id: string | null };
                return { ...prev, teacher: true, depth: d.depth };
              }
              case "citations": {
                const d = data as { citations: MentorCitation[]; weak: boolean };
                return { ...prev, citations: d.citations, weak: d.weak };
              }
              case "web_sources":
                return { ...prev, webSources: (data as { web_sources: MentorWebSource[] }).web_sources };
              case "source": {
                const d = data as { from_cache: boolean; similar?: boolean };
                return { ...prev, fromCache: d.from_cache, similar: d.similar ?? false };
              }
              case "delta":
                return { ...prev, answer: prev.answer + (data as { text: string }).text };
              case "related_pyqs":
                return { ...prev, relatedPyqs: (data as { pyqs: MentorPyqRef[] }).pyqs };
              case "quick_check":
                return { ...prev, quickCheck: (data as { questions: MentorQuizQuestion[] }).questions };
              case "continue_with":
                return { ...prev, continueWith: (data as { nodes: MentorContinueNode[] }).nodes };
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
