import { useQuery } from "@tanstack/react-query";
import { masteryMapResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Conquest Map data for a paper — every node annotated with mastery + PYQ weight. */
export function useMastery(paperCode: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mastery(paperCode),
    queryFn: () => api.get("/api/v1/mastery", masteryMapResponseSchema, { paper: paperCode }),
    enabled: !!paperCode,
  });
}
