import { useQuery } from "@tanstack/react-query";
import { examCutoffsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Official Prelims cut-offs for one PAPER of the caller's own exam.
 *
 * `paperCode` is required, with no default: a defaulted exam-shaped parameter is
 * how a caller silently keeps the old single-exam behaviour (the same trap
 * `getMasteryMap`/`getCutoffs` hit server-side). The query-string key stays
 * `exam` because that is the public API contract — the server-side rename of
 * that param is tracked separately (M12); it has always carried a paper code.
 *
 * The server scopes the rows to the caller's `target_exam`, so a user whose exam
 * has no seeded cut-offs gets an empty list rather than another exam's numbers.
 */
export function useCutoffs(paperCode: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.cutoffs(paperCode ?? "none"),
    queryFn: () => api.get("/api/v1/mocks/cutoffs", examCutoffsResponseSchema, { exam: paperCode! }),
    enabled: enabled && !!paperCode,
    // Official cut-offs only change once a year, at most.
    staleTime: 60 * 60_000,
  });
}
