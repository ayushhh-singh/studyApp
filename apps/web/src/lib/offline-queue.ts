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
  let flushing = false;

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
      void flush();
    }, delay);
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    const queue = readQueue();
    if (queue.size === 0) {
      setStatus("idle");
      return;
    }
    flushing = true;
    setStatus("pending");
    const items = [...queue.values()];
    try {
      await opts.send(items);
      const remaining = readQueue();
      for (const item of items) remaining.delete(opts.dedupeKey(item));
      writeQueue(remaining);
      flushing = false;
      if (remaining.size > 0) {
        scheduleFlush(0);
      } else {
        setStatus("idle");
      }
    } catch {
      flushing = false;
      setStatus("error");
      scheduleFlush(retryDelayMs);
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
