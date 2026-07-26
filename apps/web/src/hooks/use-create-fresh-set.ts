import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  freshSetResponseSchema,
  type CreateFreshCustomSetBody,
  type CreateFreshMockSetBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * "Show me a new set" — a SELECTION against the demand-aware reserve, resolved
 * instantly server-side (never a live generation call). Returns either a
 * ready-to-take test or an honest `preparing` state; the caller navigates on
 * `ready` and shows a "check back" message on `preparing`.
 */
export function useCreateFreshCustomSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFreshCustomSetBody) => api.post("/api/v1/tests/fresh/custom", freshSetResponseSchema, body),
    onSuccess: (result) => {
      if (result.status === "ready") queryClient.setQueryData(queryKeys.test(result.test.id), result.test);
    },
  });
}

export function useCreateFreshMockSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFreshMockSetBody) => api.post("/api/v1/tests/fresh/mock", freshSetResponseSchema, body),
    onSuccess: (result) => {
      if (result.status === "ready") queryClient.setQueryData(queryKeys.test(result.test.id), result.test);
    },
  });
}
