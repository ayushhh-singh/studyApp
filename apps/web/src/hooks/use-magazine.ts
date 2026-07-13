import { useQuery } from "@tanstack/react-query";
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
