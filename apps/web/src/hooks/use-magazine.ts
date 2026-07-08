import { useQuery } from "@tanstack/react-query";
import { magazineMonthsResponseSchema, magazineResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useMagazineMonths() {
  return useQuery({
    queryKey: queryKeys.magazineMonths(),
    queryFn: () => api.get("/api/v1/magazine", magazineMonthsResponseSchema),
    staleTime: 10 * 60_000,
  });
}

export function useMagazine(month: string) {
  return useQuery({
    queryKey: queryKeys.magazine(month),
    queryFn: () => api.get(`/api/v1/magazine/${month}`, magazineResponseSchema),
    enabled: /^\d{4}-\d{2}$/.test(month),
    // A past month's compiled magazine is immutable once the month has rolled over.
    staleTime: 30 * 60_000,
  });
}
