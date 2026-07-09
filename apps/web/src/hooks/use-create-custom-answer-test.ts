import { useMutation, useQueryClient } from "@tanstack/react-query";
import { testDetailResponseSchema, type CreateCustomAnswerTestBody } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCreateCustomAnswerTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomAnswerTestBody) =>
      api.post("/api/v1/tests/custom-answer", testDetailResponseSchema, body),
    onSuccess: (test) => {
      queryClient.setQueryData(queryKeys.test(test.id), test);
      queryClient.invalidateQueries({ queryKey: ["tests"] });
    },
  });
}
