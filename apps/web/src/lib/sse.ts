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
 * Thrown from onopen (see below) when the pre-flight HTTP response itself
 * failed — before any SSE stream was ever opened (e.g. a 429 from the
 * rateLimit() middleware, a 402/404 from a pre-flight check). Carries the
 * real status and, when the server sent one, the parsed `error` message from
 * the {data,error} envelope, plus the Retry-After seconds on a 429 so a
 * caller can render an actual countdown instead of a generic message.
 */
export class SseError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
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
          // Nothing else consumes the body in this path (we throw before any
          // streaming starts), so it's safe to read it here for a real
          // message instead of a bare status code.
          let message = `SSE connection failed (HTTP ${response.status})`;
          try {
            const envelope = (await response.json()) as { error?: string };
            if (typeof envelope.error === "string" && envelope.error) message = envelope.error;
          } catch {
            // Non-JSON body (e.g. a proxy error page) — keep the generic message.
          }
          // Retry-After is defined as delta-seconds OR an HTTP-date; we only
          // ever send delta-seconds (see lib/rate-limit.ts), so a date string
          // (or anything else non-numeric) correctly falls through to
          // undefined here rather than being misread as a seconds value.
          const retryAfterHeader = response.headers.get("Retry-After");
          const parsedRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const retryAfterSeconds =
            Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0 ? Math.round(parsedRetryAfter) : undefined;
          throw new SseError(response.status, message, retryAfterSeconds);
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
