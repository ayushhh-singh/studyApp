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
 *
 * The ledger maps key -> a signature of the CONTENT last successfully sent
 * under that key, not just the bare key. That distinction matters: a create
 * and a later edit of the SAME entry can share a key (an update's key is the
 * entry's own id), and if the create already reached the server while a
 * sibling item in the same batch is still stuck failing, the outer queue
 * won't have removed the create yet either. If the user then edits the entry
 * again before that batch clears, `enqueue()` overwrites the SAME key with
 * the new content — a bare "this key is done" flag would silently skip
 * sending it (the ledger would still match on key alone), quietly dropping
 * the edit while the UI reports everything as synced. Keying the ledger on
 * key+content instead means a changed payload is never mistaken for one
 * that was already delivered.
 */
import { createOfflineQueue, type OfflineQueue } from "@/lib/offline-queue";

function readLedger(ledgerKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(ledgerKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeLedger(ledgerKey: string, ledger: Record<string, string>): void {
  try {
    localStorage.setItem(ledgerKey, JSON.stringify(ledger));
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
      const ledger = readLedger(ledgerKey);
      let anyFailed = false;
      for (const item of items) {
        const key = opts.dedupeKey(item);
        const signature = JSON.stringify(item);
        // Skip only if THIS EXACT content already reached the server — a
        // changed payload under the same key (a re-edit) always gets sent.
        if (ledger[key] === signature) continue;
        try {
          await opts.sendOne(item);
          ledger[key] = signature;
          writeLedger(ledgerKey, ledger);
        } catch {
          anyFailed = true;
        }
      }
      if (anyFailed) {
        throw new Error("sukoon write queue: one or more items failed to sync");
      }
      // Whole batch done — the outer queue is about to remove every item it
      // handed us, so the ledger has nothing left to protect for these keys.
      for (const item of items) delete ledger[opts.dedupeKey(item)];
      writeLedger(ledgerKey, ledger);
    },
  });
}
