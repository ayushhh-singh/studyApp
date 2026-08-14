import { useQuery } from "@tanstack/react-query";
import { apiEnvelopeSchema, testSeriesDetailSchema, testSeriesListResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * The scheduled test series available to this user.
 *
 * Access is decided server-side (own live exam, published — admins also see
 * drafts), so an empty list is a legitimate answer, not an error: today both
 * series are `draft`, so every non-admin correctly gets `[]`. Callers must
 * distinguish "empty" from "failed" — see `isAwaitingData`/`QueryErrorState`.
 */
export function useTestSeriesList() {
  return useQuery({
    queryKey: queryKeys.testSeriesList(),
    queryFn: () => api.get("/api/v1/test-series", apiEnvelopeSchema(testSeriesListResponseSchema)),
    staleTime: 5 * 60_000,
  });
}

/** One series' calendar, with each entry's derived per-user state. */
export function useTestSeriesDetail(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.testSeriesDetail(slug ?? ""),
    queryFn: () => api.get(`/api/v1/test-series/${slug}`, apiEnvelopeSchema(testSeriesDetailSchema)),
    enabled: !!slug,
  });
}
