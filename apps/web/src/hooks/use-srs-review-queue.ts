import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitSrsReviewsResponseSchema, type SrsRating } from "@prayasup/shared";
import { api } from "@/lib/api";
import { createIdbOfflineQueue } from "@/lib/offline-queue-idb";
import type { QueueStatus } from "@/lib/offline-queue";
import { queryKeys } from "@/lib/query-keys";

const LEGACY_LOCALSTORAGE_KEY = "prayasup-srs-reviews";

/** One-time migration for anyone with reviews stranded in the old localStorage queue from before the IndexedDB switch. */
function migrateLegacyQueue(): SrsReviewInput[] {
  try {
    const raw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (!raw) return [];
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
    return JSON.parse(raw) as SrsReviewInput[];
  } catch {
    return [];
  }
}

export interface SrsReviewInput {
  card_id: string;
  rating: SrsRating;
}

/**
 * Ratings enqueue through an IndexedDB-backed offline queue (see
 * offline-queue-idb.ts) so a dropped connection — or the app being used fully
 * offline for a whole PWA revision session — never loses a review. One global
 * queue (not per-session) since a rating is durable regardless of which
 * review session produced it.
 */
export function useSrsReviewQueue(): {
  saveReview: (input: SrsReviewInput) => void;
  flushNow: () => Promise<void>;
  status: QueueStatus;
} {
  const queryClient = useQueryClient();

  const queue = useMemo(() => {
    const q = createIdbOfflineQueue<SrsReviewInput>({
      dbName: "prayasup-offline",
      storeName: "srs-reviews",
      dedupeKey: (item) => item.card_id,
      send: (reviews) =>
        api.post("/api/v1/srs/reviews", submitSrsReviewsResponseSchema, { reviews }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["srs"] });
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary() });
        }),
    });
    for (const item of migrateLegacyQueue()) q.enqueue(item);
    return q;
  }, [queryClient]);

  const status = useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.getStatus(),
  );

  useEffect(() => {
    // Flush on mount too, not just on unmount: the queue is localStorage-durable
    // and outlives a single session, so a review stranded by a closed tab or a
    // connection drop shouldn't sit unsent until the user happens to rate a NEW
    // card in some future session — the "online" listener inside the queue only
    // fires on a reconnect transition, not just because the app is freshly open
    // while already online.
    // flushNow() can reject on a genuine send failure; the queue's own
    // retry-on-error scheduling already covers recovery, so swallow here.
    queue.flushNow().catch(() => {});
    return () => {
      queue.flushNow().catch(() => {});
    };
  }, [queue]);

  return {
    saveReview: (input) => queue.enqueue(input),
    flushNow: () => queue.flushNow(),
    status,
  };
}
