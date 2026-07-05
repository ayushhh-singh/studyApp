import { useQuery } from "@tanstack/react-query";
import { testDetailResponseSchema, testsListResponseSchema, type TestKind } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useTests(filters?: { kind?: TestKind; paper?: string }) {
  return useQuery({
    queryKey: queryKeys.tests(filters),
    queryFn: () => api.get("/api/v1/tests", testsListResponseSchema, filters),
  });
}

export function useTest(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.test(id ?? ""),
    queryFn: () => api.get(`/api/v1/tests/${id}`, testDetailResponseSchema),
    enabled: !!id,
  });
}
