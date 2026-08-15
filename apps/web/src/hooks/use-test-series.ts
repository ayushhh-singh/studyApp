import { useQuery } from "@tanstack/react-query";
import { apiEnvelopeSchema, testSeriesDetailSchema, testSeriesListResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useEntitlements } from "@/hooks/use-billing";

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

/**
 * May this viewer SIT a series paper — `true` / `false` / `null` while unknown.
 *
 * ONE definition for both series surfaces, so the index and the calendar cannot
 * drift on what "locked" means. Browsing is free at every tier; this decides
 * only the start affordance (see `SeriesStartButton`).
 *
 * ⚑ A FAILED entitlement fetch resolves to `true`, NOT `false` and NOT `null`,
 * and that is the whole reason this is a hook rather than an inline ternary:
 *
 *   - `null` would be permanent. `/entitlements` is rate-limited (60/min, shared
 *     per user) and the client retries once, so two failures leave `data`
 *     undefined for the life of the page — and `null` renders the button
 *     DISABLED. A paying Max user would be locked out of their own paper by a
 *     secondary, advisory query, with no error and nothing to retry.
 *   - `false` would be worse: it would tell that same user to buy a tier they
 *     already hold.
 *   - `true` degrades to exactly the pre-gate behaviour — the button navigates
 *     and `assertSeriesAttemptAllowed` decides. THE SERVER IS THE AUTHORITY;
 *     this flag only ever moves the 402 earlier so it reads as a lock instead of
 *     a broken link. Being wrong here costs a free user one wasted click and a
 *     correct paywall, which is strictly better than a dead control.
 */
export function useSeriesEntitlement(): boolean | null {
  const q = useEntitlements();
  if (q.data) return q.data.features.test_series;
  return q.isError ? true : null;
}
