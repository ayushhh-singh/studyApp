import { useMutation, useQuery } from "@tanstack/react-query";
import { magazineMainsResponseSchema, magazineMonthsResponseSchema, magazinePrelimsResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useMagazineMonths() {
  return useQuery({
    queryKey: queryKeys.magazineMonths(),
    queryFn: () => api.get("/api/v1/magazine", magazineMonthsResponseSchema),
    staleTime: 10 * 60_000,
  });
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function useMagazinePrelims(month: string) {
  return useQuery({
    queryKey: queryKeys.magazinePrelims(month),
    queryFn: () => api.get(`/api/v1/magazine/${month}/prelims`, magazinePrelimsResponseSchema),
    enabled: MONTH_RE.test(month),
    // A past month's edition is immutable once the month has rolled over.
    staleTime: 30 * 60_000,
  });
}

export function useMagazineMains(month: string) {
  return useQuery({
    queryKey: queryKeys.magazineMains(month),
    queryFn: () => api.get(`/api/v1/magazine/${month}/mains`, magazineMainsResponseSchema),
    enabled: MONTH_RE.test(month),
    staleTime: 30 * 60_000,
  });
}

/**
 * The Pro-gated PDF export authorization. Calling this hits the server's
 * assertMagazinePdf gate: it resolves for a Pro/trial user (returning the
 * edition payload) and throws an ApiError with status 402 + feature
 * "magazine_pdf" for a Free user. The toolbar routes print through this so the
 * gate is server-enforced, not just a client-side entitlements check.
 */
export function useMagazineExport() {
  return useMutation({
    // Returns void — the toolbar only needs the authorization (success vs a 402
    // throw); the edition payload the endpoint returns is already loaded in the
    // free web view, so it's discarded here.
    mutationFn: async ({ month, edition }: { month: string; edition: "prelims" | "mains" }): Promise<void> => {
      if (edition === "prelims") {
        await api.get(`/api/v1/magazine/${month}/prelims/export`, magazinePrelimsResponseSchema);
      } else {
        await api.get(`/api/v1/magazine/${month}/mains/export`, magazineMainsResponseSchema);
      }
    },
  });
}
