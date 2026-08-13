import { useQuery } from "@tanstack/react-query";
import { papersResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * `enabled` exists because /resources is a PUBLIC route: this endpoint sits
 * behind requireAuth, so calling it signed-out is a guaranteed 401 that would
 * render as a load error on a marketing page. Callers on a public surface must
 * pass `{ enabled: !!session }` and show a signed-out variant instead.
 */
export function usePaperSummaries({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.paperSummaries(),
    queryFn: () => api.get("/api/v1/syllabus/papers", papersResponseSchema),
    staleTime: 5 * 60_000,
    enabled,
  });
}
