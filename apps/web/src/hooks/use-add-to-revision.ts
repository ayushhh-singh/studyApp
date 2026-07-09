import { useMutation } from "@tanstack/react-query";
import { srsCardResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { useInvalidateSrs } from "@/hooks/use-srs";

// Every mutation here invalidates the same ["srs"] query family that the
// Revision page's Review tab reads (due queue + stats) — without it, a card
// added from e.g. an evaluation's results page is correctly persisted (and
// shows up fine in Manage, which is never pre-fetched) but the Review tab can
// keep serving an already-cached, pre-add stats/due-queue snapshot for up to
// the default 30s staleTime, making the new card look like it never arrived.

export function useAddToRevision() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post("/api/v1/srs/cards/from-node", srsCardResponseSchema, { node_id: nodeId }),
    onSuccess: invalidate,
  });
}

export function useAddQuestionToRevision() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (questionId: string) =>
      api.post("/api/v1/srs/cards/from-question", srsCardResponseSchema, { question_id: questionId }),
    onSuccess: invalidate,
  });
}

export function useAddEvaluationToRevision() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: (submissionId: string) =>
      api.post("/api/v1/srs/cards/from-evaluation", srsCardResponseSchema, { submission_id: submissionId }),
    onSuccess: invalidate,
  });
}

export function useAddCurrentAffairsFactToRevision() {
  const invalidate = useInvalidateSrs();
  return useMutation({
    mutationFn: ({ itemId, factIndex }: { itemId: string; factIndex: number }) =>
      api.post("/api/v1/srs/cards/from-current-affairs-fact", srsCardResponseSchema, {
        item_id: itemId,
        fact_index: factIndex,
      }),
    onSuccess: invalidate,
  });
}
