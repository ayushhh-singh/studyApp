import { useMutation } from "@tanstack/react-query";
import { ghostStartResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";

/** Start a Ghost Battle replay of a completed attempt. */
export function useStartGhost() {
  return useMutation({
    mutationFn: (previousAttemptId: string) =>
      api.post(`/api/v1/attempts/${previousAttemptId}/ghost`, ghostStartResponseSchema),
  });
}
