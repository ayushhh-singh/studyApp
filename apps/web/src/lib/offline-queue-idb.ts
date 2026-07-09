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

// Keyed by `dbName::storeName` — see the singleton guard at the bottom of
// createIdbOfflineQueue for why this exists: the factory has an un-cleaned-up
// `window.addEventListener('online', ...)` side effect (see below), and
// callers construct a queue inside `useMemo` (use-srs-review-queue.ts).
// React StrictMode's dev-only double-invocation of useMemo factories on the
// initial render calls this factory TWICE for the exact same
// dbName/storeName — without de-duping, that leaks a second, fully
// independent queue instance (its own queueTail/flushTimer/IndexedDB reads)
// whose 'online' listener nobody ever unsubscribes. Live-verified this leak
// in effect: coming back online after a batch of offline SRS reviews sent
// the exact same batch to POST /srs/reviews TWICE (both 201), because two
// orphaned queue instances both independently flushed the same
// not-yet-removed IndexedDB rows before either had removed them. Reusing
// the same singleton per storage key makes repeat construction (StrictMode,
// or simply remounting the same durable queue on a later page visit) a
// no-op instead of a second live listener.
const instances = new Map<string, OfflineQueue<unknown>>();

export function createIdbOfflineQueue<T>(opts: {
  dbName: string;
  storeName: string;
  dedupeKey: (item: T) => string;
  send: (items: T[]) => Promise<void>;
  retryDelayMs?: number;
}): OfflineQueue<T> {
  const cacheKey = `${opts.dbName}::${opts.storeName}`;
  const existing = instances.get(cacheKey);
  if (existing) return existing as OfflineQueue<T>;

  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const listeners = new Set<() => void>();
  let status: QueueStatus = "idle";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Every caller chains onto this instead of racing independent runOnce()
  // calls guarded by a nullable "is something active" flag — that flag has a
  // real gap: a piggybacking caller only checks it ONCE before awaiting, then
  // re-checks the queue afterward with no re-check of whether a NEW flush
  // (e.g. the original's own retry-on-failure recursion) has since started,
  // so it can barge in with a second concurrent send. A single serialized
  // tail makes that reordering impossible — see the retry-storm bug this
  // fixed (rapid enqueue + a failing send could fan out into 100+ concurrent
  // POSTs of the same batch).
  let queueTail: Promise<void> = Promise.resolve();

  // A single cached `openDB()` promise would, once rejected (a transient
  // failure — e.g. Safari private-mode's historically strict IndexedDB
  // quota), stay rejected forever: awaiting an already-settled promise always
  // replays the same outcome, it never retries. That would permanently break
  // this queue for the rest of the page's life after one bad open. Retrying
  // lazily on the next call instead lets a transient failure self-heal.
  let dbPromise: Promise<IDBPDatabase> | null = null;
  function getDbSafe(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      dbPromise = getDb(opts.dbName, opts.storeName).catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function readAll(): Promise<T[]> {
    const db = await getDbSafe();
    return db.getAll(opts.storeName);
  }

  async function put(item: T): Promise<void> {
    const db = await getDbSafe();
    await db.put(opts.storeName, item, opts.dedupeKey(item));
  }

  async function remove(key: string): Promise<void> {
    const db = await getDbSafe();
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

  // Every caller — the enqueue-triggered timer, the online-event listener,
  // and a component's mount/unmount flushNow() — chains onto the SAME tail
  // instead of each deciding independently whether a round is "active".
  // Any item present when a flush is requested is covered by whichever
  // runOnce() ends up next in the chain, so there's no separate "drain
  // remaining" recursion to get racy either.
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
      // put() rejecting (a storage failure, not a send failure) must not
      // become an unhandled promise rejection — surface it the same way a
      // send failure already does, via `status`, so the UI can at least show
      // something didn't save instead of silently losing the item.
      put(item)
        .then(() => scheduleFlush(0))
        .catch(() => setStatus("error"));
    },
    flushNow: flush,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  instances.set(cacheKey, queue as OfflineQueue<unknown>);
  return queue;
}
