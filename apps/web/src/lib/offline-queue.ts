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

// Keyed by storageKey — see offline-queue-idb.ts's identical guard for the
// full explanation. In short: this factory's `window.addEventListener`
// below has no teardown, and use-attempt-answers.ts constructs a queue
// inside `useMemo`, which React StrictMode's dev-only double-invocation
// calls twice on the initial render for the same deps — without de-duping,
// that leaks a second, fully independent queue instance (its own
// queueTail/flushTimer/localStorage reads) with its own live 'online'
// listener, which can double-send an already-queued batch when
// connectivity returns (confirmed for the IndexedDB sibling; same
// mechanism applies here since the code shape is identical).
const instances = new Map<string, OfflineQueue<unknown>>();

export function createOfflineQueue<T>(opts: {
  storageKey: string;
  dedupeKey: (item: T) => string;
  send: (items: T[]) => Promise<void>;
  retryDelayMs?: number;
}): OfflineQueue<T> {
  const existing = instances.get(opts.storageKey);
  if (existing) return existing as OfflineQueue<T>;

  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const listeners = new Set<() => void>();
  let status: QueueStatus = "idle";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Every caller chains onto this instead of racing independent runOnce()
  // calls guarded by a nullable "is something active" flag — see
  // offline-queue-idb.ts's identical fix for the exact race that flag had
  // (a piggybacking caller only checked it once before awaiting, then never
  // re-checked whether a NEW flush — e.g. the original's own retry-on-failure
  // recursion — had since started, so it could barge in with a second
  // concurrent send).
  let queueTail: Promise<void> = Promise.resolve();

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
   * Flush the queue. The returned promise resolves once THIS caller's turn
   * in the chain has actually reached the server — every concurrent caller
   * (an autosave-triggered background flush racing an explicit flushNow()
   * from a submit handler) chains onto the same serialized tail rather than
   * returning before any request completed, so a submit handler can't
   * proceed before the last autosaved answer is confirmed persisted. Items
   * enqueued while an earlier round is in flight are picked up by whichever
   * runOnce() ends up next in the chain (it re-reads the queue fresh), so
   * there's no separate "drain remaining" recursion needed either.
   */
  function flush(): Promise<void> {
    const attempt = queueTail.catch(() => {}).then(runOnce);
    queueTail = attempt.catch(() => {});
    return attempt;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => scheduleFlush(0));
  }

  const queue: OfflineQueue<T> = {
    enqueue(item) {
      const q = readQueue();
      q.set(opts.dedupeKey(item), item);
      writeQueue(q);
      scheduleFlush(0);
    },
    flushNow: flush,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  instances.set(opts.storageKey, queue as OfflineQueue<unknown>);
  return queue;
}
