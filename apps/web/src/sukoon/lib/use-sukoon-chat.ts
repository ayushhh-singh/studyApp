import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  sukoonChatHistoryResponseSchema,
  sukoonChatUsageResponseSchema,
  sukoonConversationsResponseSchema,
  type SukoonCrisisLevel,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

/** Today's chat-cap meter (drives "N left" + input disable at 0). */
export function useSaathiUsage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonChatUsage(),
    queryFn: () => api.get("/api/sukoon/chat/usage", sukoonChatUsageResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

/** The history-drawer conversation list. */
export function useSaathiConversations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonConversations(),
    queryFn: () =>
      api
        .get("/api/sukoon/chat/conversations", sukoonConversationsResponseSchema)
        .then((d) => d.conversations),
    enabled: options?.enabled ?? true,
  });
}

/**
 * Messages of one conversation (the latest when `conversationId` is undefined).
 * `conversation` is null when the user has no conversations yet.
 */
export function useSaathiHistory(conversationId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonChatHistory(conversationId),
    queryFn: () =>
      api.get(
        `/api/sukoon/chat/history${conversationId ? `?conversation_id=${conversationId}` : ""}`,
        sukoonChatHistoryResponseSchema,
      ),
    enabled: options?.enabled ?? true,
  });
}

export interface CapState {
  tier: string;
  limit: number;
}

/** The final snapshot handed to onDone — fresh (not stale-closured) accumulated state. */
export interface SaathiSettled {
  outcome: "done" | "takeover" | "cap" | "error";
  conversationId: string | null;
  reply: string;
  crisisLevel: SukoonCrisisLevel | null;
  crisisSurface: "inline" | "takeover" | null;
  cap: CapState | null;
  doneMessageId: string | null;
  error: string | null;
}

export interface SaathiStreamState {
  isStreaming: boolean;
  /** Accumulating assistant reply text (for the live bubble). */
  reply: string;
  /** Crisis surface while streaming — drives the inline card above the live bubble. */
  crisisSurface: "inline" | "takeover" | null;
  fromCache: boolean;
}

const INITIAL: SaathiStreamState = {
  isStreaming: false,
  reply: "",
  crisisSurface: null,
  fromCache: false,
};

/**
 * Drives POST /api/sukoon/chat/stream. Mirrors the mentor's useDoubtStream: one
 * code path handles a live model stream (many deltas), a semantic-cache replay
 * (one full delta), a crisis takeover (a `crisis` event, no reply), and the
 * daily-cap state (a `cap` event). `onDone` receives a FRESH snapshot (built
 * from a ref, not React state) so the caller can commit without stale-closure
 * bugs; the exposed state is only for rendering the in-flight bubble.
 */
export function useSaathiStream() {
  const [state, setState] = useState<SaathiStreamState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const send = useCallback(
    (content: string, conversationId: string | null, opts: { onDone?: (r: SaathiSettled) => void } = {}) => {
      controllerRef.current?.abort();
      setState({ ...INITIAL, isStreaming: true });

      // Synchronous accumulator — the source of truth handed to onDone.
      const acc: SaathiSettled = {
        outcome: "done",
        conversationId,
        reply: "",
        crisisLevel: null,
        crisisSurface: null,
        cap: null,
        doneMessageId: null,
        error: null,
      };
      let settled = false;
      const finish = (outcome: SaathiSettled["outcome"]) => {
        if (settled) return;
        settled = true;
        acc.outcome = outcome;
        opts.onDone?.({ ...acc });
      };

      controllerRef.current = streamEvents({
        url: `${API_URL}/api/sukoon/chat/stream`,
        method: "POST",
        body: { content, conversation_id: conversationId },
        onEvent: (event, data) => {
          switch (event) {
            case "conversation":
              acc.conversationId = (data as { id: string }).id;
              break;
            case "crisis": {
              const d = data as { level: SukoonCrisisLevel; surface: "inline" | "takeover" };
              acc.crisisLevel = d.level;
              acc.crisisSurface = d.surface;
              setState((prev) => ({ ...prev, crisisSurface: d.surface }));
              break;
            }
            case "source":
              setState((prev) => ({ ...prev, fromCache: (data as { from_cache: boolean }).from_cache }));
              break;
            case "delta": {
              const text = (data as { text: string }).text;
              acc.reply += text;
              setState((prev) => ({ ...prev, reply: prev.reply + text }));
              break;
            }
            case "cap":
              acc.cap = data as CapState;
              setState((prev) => ({ ...prev, isStreaming: false }));
              finish("cap");
              break;
            case "done":
              acc.doneMessageId = (data as { message_id: string | null }).message_id;
              setState((prev) => ({ ...prev, isStreaming: false }));
              finish(acc.crisisSurface === "takeover" ? "takeover" : "done");
              break;
            case "error":
              acc.error = (data as { message: string }).message;
              setState((prev) => ({ ...prev, isStreaming: false }));
              finish("error");
              break;
          }
        },
        onError: (err) => {
          acc.error = acc.error ?? (err instanceof Error ? err.message : "Saathi couldn't reply. Please try again.");
          setState((prev) => ({ ...prev, isStreaming: false }));
          finish("error");
        },
      });
    },
    [],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(INITIAL);
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, send, reset };
}
