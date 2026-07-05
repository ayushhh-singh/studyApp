import { useMutation } from "@tanstack/react-query";
import { srsCardResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";

export function useAddToRevision() {
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post("/api/v1/srs/cards/from-node", srsCardResponseSchema, { node_id: nodeId }),
  });
}
