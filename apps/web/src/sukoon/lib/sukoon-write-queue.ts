/**
 * Thin wrapper around the shared localStorage offline-queue (@/lib/offline-queue,
 * built for the MCQ test player's autosave and reused as-is here — see
 * SUKOON_CONTEXT.md: shared infra is fair game, Sukoon just never imports a
 * Neev *feature* module) for journal entries and mood check-ins.
 *
 * The generic queue's `send(items)` contract is all-or-nothing per flush: if it
 * throws, NONE of the items it was handed get removed, and the whole batch is
 * resent on the next retry. That's safe when every item in a batch hits the
 * SAME idempotent endpoint (attempt answers, SRS reviews — one POST for the
 * whole array). It is NOT safe here: a journal/mood save can be a "create"
 * (POST, not naturally idempotent — a resend inserts a second row) or an
 * "update" (PATCH by id, a full replace, and re-sending an already-applied
 * PATCH is harmless). If two different entries are queued together (e.g. the
 * user wrote two journal entries before ever reconnecting) and only one of
 * them fails to sync, a plain all-or-nothing retry would re-POST the one that
 * already succeeded — a real duplicate entry, not a hypothetical one.
 *
 * This wrapper closes that gap with a small persisted ledger of item keys that
 * have already reached the server: `sendOne` is tried per item, a success is
 * recorded in the ledger immediately (survives a reload mid-retry), and any
 * later resend of the same batch skips the network call for keys already in
 * the ledger. Only once every item in a flush attempt is done (or was already
 * done) does the wrapped `send()` resolve, letting the outer queue clear them
 * all out for good.
 */
import { createOfflineQueue, type OfflineQueue } from "@/lib/offline-queue";

function readLedger(ledgerKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(ledgerKey);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeLedger(ledgerKey: string, keys: Set<string>): void {
  try {
    localStorage.setItem(ledgerKey, JSON.stringify([...keys]));
  } catch {
    // best-effort — worst case a just-completed item is attempted once more
    // next retry, which sendOne must already tolerate being asked to no-op on.
  }
}

export function createSukoonWriteQueue<T>(opts: {
  storageKey: string;
  dedupeKey: (item: T) => string;
  /** Perform ONE item's server call. Must throw (not swallow) on failure. */
  sendOne: (item: T) => Promise<void>;
  retryDelayMs?: number;
}): OfflineQueue<T> {
  const ledgerKey = `${opts.storageKey}:done`;

  return createOfflineQueue<T>({
    storageKey: opts.storageKey,
    dedupeKey: opts.dedupeKey,
    retryDelayMs: opts.retryDelayMs,
    send: async (items) => {
      const done = readLedger(ledgerKey);
      let anyFailed = false;
      for (const item of items) {
        const key = opts.dedupeKey(item);
        if (done.has(key)) continue; // already reached the server in an earlier partial attempt
        try {
          await opts.sendOne(item);
          done.add(key);
          writeLedger(ledgerKey, done);
        } catch {
          anyFailed = true;
        }
      }
      if (anyFailed) {
        throw new Error("sukoon write queue: one or more items failed to sync");
      }
      // Whole batch done — the outer queue is about to remove every item it
      // handed us, so the ledger has nothing left to protect for these keys.
      for (const item of items) done.delete(opts.dedupeKey(item));
      writeLedger(ledgerKey, done);
    },
  });
}
