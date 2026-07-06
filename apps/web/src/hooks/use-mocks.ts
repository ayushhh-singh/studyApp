import { useQuery } from "@tanstack/react-query";
import { examCutoffsResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Official UPPSC Prelims cut-offs for the mock-result comparison. */
export function useCutoffs(exam = "PRE_GS1", enabled = true) {
  return useQuery({
    queryKey: queryKeys.cutoffs(exam),
    queryFn: () => api.get("/api/v1/mocks/cutoffs", examCutoffsResponseSchema, { exam }),
    enabled,
  });
}
