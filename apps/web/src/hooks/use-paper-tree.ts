import { useQuery } from "@tanstack/react-query";
import { paperTreeResponseSchema, paperTrendsResponseSchema, type ExamCode } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function usePaperTree(paperCode: string | undefined, exam?: ExamCode) {
  return useQuery({
    queryKey: queryKeys.paperTree(paperCode ?? "", exam),
    queryFn: () => api.get(`/api/v1/syllabus/papers/${paperCode}/tree`, paperTreeResponseSchema, { exam }),
    enabled: !!paperCode,
  });
}

export function usePaperTrends(paperCode: string | undefined, exam?: ExamCode) {
  return useQuery({
    queryKey: queryKeys.paperTrends(paperCode ?? "", exam),
    queryFn: () => api.get(`/api/v1/syllabus/papers/${paperCode}/trends`, paperTrendsResponseSchema, { exam }),
    enabled: !!paperCode,
  });
}
