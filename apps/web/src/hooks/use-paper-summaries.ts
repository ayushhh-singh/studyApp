import { useQuery } from "@tanstack/react-query";
import { papersResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function usePaperSummaries() {
  return useQuery({
    queryKey: queryKeys.paperSummaries(),
    queryFn: () => api.get("/api/v1/syllabus/papers", papersResponseSchema),
    staleTime: 5 * 60_000,
  });
}
