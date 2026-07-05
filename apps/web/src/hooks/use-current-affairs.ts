import { useQuery } from "@tanstack/react-query";
import { currentAffairsResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useCurrentAffairs(filters?: {
  date?: string;
  category?: string;
  up_only?: boolean;
  page?: number;
}) {
  return useQuery({
    queryKey: queryKeys.currentAffairs(filters),
    queryFn: () => api.get("/api/v1/current-affairs", currentAffairsResponseSchema, filters),
  });
}
