import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitSrsReviewsResponseSchema, type SrsRating } from "@prayasup/shared";
import { api } from "@/lib/api";
import { createOfflineQueue, type QueueStatus } from "@/lib/offline-queue";
import { queryKeys } from "@/lib/query-keys";

export interface SrsReviewInput {
  card_id: string;
  rating: SrsRating;
}

/**
 * Ratings enqueue through the shared offline-queue (see use-attempt-answers.ts
 * for the template) so a dropped connection mid-session never loses a review —
 * the queue persists to localStorage and retries until it lands. One global
 * queue (not per-session) since a rating is durable regardless of which
 * review session produced it.
 */
export function useSrsReviewQueue(): {
  saveReview: (input: SrsReviewInput) => void;
  flushNow: () => Promise<void>;
  status: QueueStatus;
} {
  const queryClient = useQueryClient();

  const queue = useMemo(
    () =>
      createOfflineQueue<SrsReviewInput>({
        storageKey: "prayasup-srs-reviews",
        dedupeKey: (item) => item.card_id,
        send: (reviews) =>
          api.post("/api/v1/srs/reviews", submitSrsReviewsResponseSchema, { reviews }).then(() => {
            queryClient.invalidateQueries({ queryKey: ["srs"] });
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboardSummary() });
          }),
      }),
    [queryClient],
  );

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
