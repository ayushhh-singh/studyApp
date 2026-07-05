import { useMutation } from "@tanstack/react-query";
import { srsCardResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";

export function useAddToRevision() {
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post("/api/v1/srs/cards/from-node", srsCardResponseSchema, { node_id: nodeId }),
  });
}

export function useAddQuestionToRevision() {
  return useMutation({
    mutationFn: (questionId: string) =>
      api.post("/api/v1/srs/cards/from-question", srsCardResponseSchema, { question_id: questionId }),
  });
}

export function useAddEvaluationToRevision() {
  return useMutation({
    mutationFn: (submissionId: string) =>
      api.post("/api/v1/srs/cards/from-evaluation", srsCardResponseSchema, { submission_id: submissionId }),
  });
}

export function useAddCurrentAffairsFactToRevision() {
  return useMutation({
    mutationFn: ({ itemId, factIndex }: { itemId: string; factIndex: number }) =>
      api.post("/api/v1/srs/cards/from-current-affairs-fact", srsCardResponseSchema, {
        item_id: itemId,
        fact_index: factIndex,
      }),
  });
}
