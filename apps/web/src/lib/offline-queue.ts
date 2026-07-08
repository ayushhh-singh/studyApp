/**
 * Generic localStorage-persisted retry queue. Callers enqueue full, current
 * snapshots of an item (not partial patches) keyed by `dedupeKey` — the queue
 * always flushes the latest snapshot per key, so it never needs to merge
 * partial updates itself. Built for the test-player autosave path; written
 * generic so the PWA offline sync work can reuse it later.
 */

export type QueueStatus = "idle" | "pending" | "error";

export interface OfflineQueue<T> {
  enqueue: (item: T) => void;
  flushNow: () => Promise<void>;
  getStatus: () => QueueStatus;
  subscribe: (listener: () => void) => () => void;
}

export function createOfflineQueue<T>(opts: {
  storageKey: string;
  dedupeKey: (item: T) => string;
  send: (items: T[]) => Promise<void>;
  retryDelayMs?: number;
}): OfflineQueue<T> {
  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const listeners = new Set<() => void>();
  let status: QueueStatus = "idle";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let activeFlush: Promise<void> | null = null;

  function readQueue(): Map<string, T> {
    try {
      const raw = localStorage.getItem(opts.storageKey);
      if (!raw) return new Map();
      const items = JSON.parse(raw) as T[];
      return new Map(items.map((item) => [opts.dedupeKey(item), item]));
    } catch {
      return new Map();
    }
  }

  function writeQueue(queue: Map<string, T>): void {
    try {
      localStorage.setItem(opts.storageKey, JSON.stringify([...queue.values()]));
    } catch {
      // localStorage unavailable (private mode / quota) — queue still flushes
      // in-memory for this page lifetime, just won't survive a reload.
    }
  }

  function setStatus(next: QueueStatus): void {
    status = next;
    for (const listener of listeners) listener();
  }

  function scheduleFlush(delay: number): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Background-triggered flushes (from enqueue/online) swallow their own
      // failure — status already reflects "error" and a retry is already
      // scheduled inside runOnce's catch. An explicit flushNow() caller still
      // sees the rejection (see flush() below).
      flush().catch(() => {});
    }, delay);
  }

  async function runOnce(): Promise<void> {
    const queue = readQueue();
    if (queue.size === 0) {
      setStatus("idle");
      return;
    }
    setStatus("pending");
    const items = [...queue.values()];
    try {
      await opts.send(items);
      const remaining = readQueue();
      for (const item of items) remaining.delete(opts.dedupeKey(item));
      writeQueue(remaining);
      setStatus(remaining.size > 0 ? "pending" : "idle");
    } catch (err) {
      setStatus("error");
      scheduleFlush(retryDelayMs);
      throw err;
    }
  }

  /**
   * Flush the queue, guaranteeing the returned promise only resolves once
   * everything that was in the queue at call time has actually reached the
   * server. Concurrent callers (e.g. an autosave-triggered background flush
   * racing an explicit flushNow() from a submit handler) piggyback on the
   * in-flight round instead of returning immediately — the old code let a
   * caller return before ANY request had actually completed if another flush
   * was already running, which could let a caller proceed (e.g. submitting a
   * test) before the last autosaved answer was confirmed persisted.
   */
  async function flush(): Promise<void> {
    if (activeFlush) {
      await activeFlush.catch(() => {});
      if (readQueue().size === 0) return;
    }
    const run = runOnce();
    activeFlush = run;
    try {
      await run;
    } finally {
      if (activeFlush === run) activeFlush = null;
    }
    // Items enqueued while this round was in flight aren't covered by it —
    // flush those too before resolving.
    if (readQueue().size > 0) {
      await flush();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => scheduleFlush(0));
  }

  return {
    enqueue(item) {
      const queue = readQueue();
      queue.set(opts.dedupeKey(item), item);
      writeQueue(queue);
      scheduleFlush(0);
    },
    flushNow: flush,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
