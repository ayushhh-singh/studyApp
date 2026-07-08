/**
 * IndexedDB-backed sibling of offline-queue.ts, same OfflineQueue<T> contract
 * (enqueue/flushNow/getStatus/subscribe) so callers don't change shape — only
 * the storage swaps. Used where the queue needs to survive well beyond a
 * localStorage-sized budget (a long offline revision session can queue
 * hundreds of ratings) and where PWA offline use makes "still queued after
 * the tab was closed and reopened" a real scenario, not an edge case.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { OfflineQueue, QueueStatus } from "./offline-queue";

async function getDb(dbName: string, storeName: string): Promise<IDBPDatabase> {
  return openDB(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    },
  });
}

export function createIdbOfflineQueue<T>(opts: {
  dbName: string;
  storeName: string;
  dedupeKey: (item: T) => string;
  send: (items: T[]) => Promise<void>;
  retryDelayMs?: number;
}): OfflineQueue<T> {
  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const listeners = new Set<() => void>();
  let status: QueueStatus = "idle";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let activeFlush: Promise<void> | null = null;
  const dbPromise = getDb(opts.dbName, opts.storeName);

  async function readAll(): Promise<T[]> {
    const db = await dbPromise;
    return db.getAll(opts.storeName);
  }

  async function put(item: T): Promise<void> {
    const db = await dbPromise;
    await db.put(opts.storeName, item, opts.dedupeKey(item));
  }

  async function remove(key: string): Promise<void> {
    const db = await dbPromise;
    await db.delete(opts.storeName, key);
  }

  function setStatus(next: QueueStatus): void {
    status = next;
    for (const listener of listeners) listener();
  }

  function scheduleFlush(delay: number): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, delay);
  }

  async function runOnce(): Promise<void> {
    const items = await readAll();
    if (items.length === 0) {
      setStatus("idle");
      return;
    }
    setStatus("pending");
    try {
      await opts.send(items);
      await Promise.all(items.map((item) => remove(opts.dedupeKey(item))));
      const remaining = await readAll();
      setStatus(remaining.length > 0 ? "pending" : "idle");
    } catch (err) {
      setStatus("error");
      scheduleFlush(retryDelayMs);
      throw err;
    }
  }

  // See offline-queue.ts's flush() for why concurrent callers piggyback on
  // the in-flight round rather than each racing their own read/send/clear.
  async function flush(): Promise<void> {
    if (activeFlush) {
      await activeFlush.catch(() => {});
      if ((await readAll()).length === 0) return;
    }
    const run = runOnce();
    activeFlush = run;
    try {
      await run;
    } finally {
      if (activeFlush === run) activeFlush = null;
    }
    if ((await readAll()).length > 0) {
      await flush();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => scheduleFlush(0));
  }

  return {
    enqueue(item) {
      void put(item).then(() => scheduleFlush(0));
    },
    flushNow: flush,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
