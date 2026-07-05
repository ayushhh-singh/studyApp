import { useCallback, useEffect, useRef, useState } from "react";
import type { BilingualText, Locale } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

interface ExplainState {
  text: string;
  isStreaming: boolean;
  error: string | null;
}

/** Streams an on-demand AI explanation for one question from /stream/explain/:questionId. */
export function useExplainQuestion(questionId: string) {
  const [state, setState] = useState<ExplainState>({ text: "", isStreaming: false, error: null });
  const controllerRef = useRef<AbortController | null>(null);

  const explain = useCallback(
    (locale: Locale, onDone: (explanationI18n: BilingualText) => void) => {
      controllerRef.current?.abort();
      setState({ text: "", isStreaming: true, error: null });
      controllerRef.current = streamEvents({
        url: `${API_URL}/api/v1/stream/explain/${questionId}?locale=${locale}`,
        onEvent: (event, data) => {
          if (event === "delta") {
            const { text } = data as { text: string };
            setState((prev) => ({ ...prev, text: prev.text + text }));
          } else if (event === "done") {
            const { explanation_i18n } = data as { explanation_i18n: BilingualText };
            setState((prev) => ({ ...prev, isStreaming: false }));
            onDone(explanation_i18n);
          } else if (event === "error") {
            const { message } = data as { message: string };
            setState((prev) => ({ ...prev, isStreaming: false, error: message }));
          }
        },
        onError: (err) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: err instanceof Error ? err.message : "Stream failed",
          }));
        },
      });
    },
    [questionId],
  );

  // Abort an in-flight stream when the owning row unmounts (e.g. the user
  // navigates away mid-generation) — otherwise the SSE connection and the
  // server-side LLM call it's driving keep running for no one.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, explain };
}
