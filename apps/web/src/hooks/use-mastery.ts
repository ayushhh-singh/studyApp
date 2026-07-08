import { useQuery } from "@tanstack/react-query";
import { masteryMapResponseSchema, type ExamCode } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Conquest Map data for a paper — every node annotated with mastery + PYQ weight. */
export function useMastery(paperCode: string | undefined, exam?: ExamCode) {
  return useQuery({
    queryKey: queryKeys.mastery(paperCode, exam),
    queryFn: () => api.get("/api/v1/mastery", masteryMapResponseSchema, { paper: paperCode, exam }),
    enabled: !!paperCode,
  });
}
