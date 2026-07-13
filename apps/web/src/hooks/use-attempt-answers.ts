import { useEffect, useMemo, useSyncExternalStore } from "react";
import { attemptAnswersResponseSchema, type AttemptAnswerInput } from "@neev/shared";
import { api } from "@/lib/api";
import { createOfflineQueue, type QueueStatus } from "@/lib/offline-queue";

/**
 * Autosaves answers for one attempt via a localStorage-backed retry queue —
 * callers always enqueue the FULL current record for a question (chosen
 * option + time spent), never a partial patch, so last-write-wins per
 * question is always correct.
 */
export function useAttemptAnswers(attemptId: string | undefined): {
  saveAnswer: (input: AttemptAnswerInput) => void;
  flushNow: () => Promise<void>;
  status: QueueStatus;
} {
  const queue = useMemo(() => {
    if (!attemptId) return null;
    return createOfflineQueue<AttemptAnswerInput>({
      storageKey: `neev-attempt-answers-${attemptId}`,
      dedupeKey: (item) => item.question_id,
      send: (answers) =>
        api.post(`/api/v1/attempts/${attemptId}/answers`, attemptAnswersResponseSchema, { answers }).then(
          () => undefined,
        ),
    });
  }, [attemptId]);

  const status = useSyncExternalStore(
    (listener) => (queue ? queue.subscribe(listener) : () => {}),
    () => queue?.getStatus() ?? "idle",
  );

  useEffect(() => {
    return () => {
      // Best-effort on unmount — flushNow() can now reject if the send
      // genuinely fails; nothing left mounted to react to that, so swallow it
      // (the queue's own retry-on-error scheduling still runs in the background).
      queue?.flushNow().catch(() => {});
    };
  }, [queue]);

  return {
    saveAnswer: (input) => queue?.enqueue(input),
    flushNow: () => queue?.flushNow() ?? Promise.resolve(),
    status,
  };
}
