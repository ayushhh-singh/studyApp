import { useMutation, useQueryClient } from "@tanstack/react-query";
import { testDetailResponseSchema, type CreateCustomTestBody } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCreateCustomTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomTestBody) => api.post("/api/v1/tests/custom", testDetailResponseSchema, body),
    onSuccess: (test) => {
      queryClient.setQueryData(queryKeys.test(test.id), test);
      queryClient.invalidateQueries({ queryKey: queryKeys.tests() });
    },
  });
}
