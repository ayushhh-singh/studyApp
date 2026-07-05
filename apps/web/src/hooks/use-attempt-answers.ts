import { useEffect, useMemo, useSyncExternalStore } from "react";
import { attemptAnswersResponseSchema, type AttemptAnswerInput } from "@prayasup/shared";
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
  status: QueueStatus;
} {
  const queue = useMemo(() => {
    if (!attemptId) return null;
    return createOfflineQueue<AttemptAnswerInput>({
      storageKey: `prayasup-attempt-answers-${attemptId}`,
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
      void queue?.flushNow();
    };
  }, [queue]);

  return {
    saveAnswer: (input) => queue?.enqueue(input),
    status,
  };
}
