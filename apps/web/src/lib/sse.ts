import { fetchEventSource, type EventSourceMessage } from "@microsoft/fetch-event-source";
import { getAccessToken } from "./auth";

export interface StreamOptions {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  onEvent: (event: string, data: unknown) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

/**
 * Opens an SSE connection to an /api/v1/stream/* endpoint. Returns an
 * AbortController the caller uses to cancel the stream. `onerror` throws to
 * stop @microsoft/fetch-event-source's built-in retry — each of our stream
 * endpoints is stateful per-request, so silently retrying would replay a
 * dead request rather than recover it. The throw rejects the promise
 * fetchEventSource returns, so `opts.onError` is invoked exactly once, from
 * the trailing .catch() below — do not also call it inside `onerror`.
 */
export function streamEvents(opts: StreamOptions): AbortController {
  const controller = new AbortController();

  // Resolve the access token first, then open the stream with it attached.
  // fetchEventSource headers must be a plain object, so we can't do this inline;
  // the sync AbortController is returned immediately either way.
  void (async () => {
    const token = await getAccessToken();
    await fetchEventSource(opts.url, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        if (!response.ok) {
          throw new Error(`SSE connection failed (HTTP ${response.status})`);
        }
      },
      onmessage(msg: EventSourceMessage) {
        const event = msg.event || "message";
        let data: unknown = msg.data;
        try {
          data = JSON.parse(msg.data);
        } catch {
          // Not JSON — pass the raw string through.
        }
        opts.onEvent(event, data);
      },
      onclose() {
        opts.onClose?.();
      },
      onerror(err) {
        throw err;
      },
    });
  })().catch((err) => {
    if (!controller.signal.aborted) opts.onError?.(err);
  });

  return controller;
}
