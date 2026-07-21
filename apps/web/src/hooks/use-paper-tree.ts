import { useQuery } from "@tanstack/react-query";
import { paperTreeResponseSchema, paperTrendsResponseSchema, type Difficulty, type ExamCode } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

// `difficulty` narrows the per-node PYQ/generated counts (and thus the custom-set
// builder's cap) to that difficulty, mirroring how the custom builder itself
// filters — so the cap matches what a set would actually deliver.
export function usePaperTree(paperCode: string | undefined, exam?: ExamCode, difficulty?: Difficulty) {
  return useQuery({
    queryKey: queryKeys.paperTree(paperCode ?? "", exam, difficulty),
    queryFn: () => api.get(`/api/v1/syllabus/papers/${paperCode}/tree`, paperTreeResponseSchema, { exam, difficulty }),
    enabled: !!paperCode,
    // Includes per-node PYQ/accuracy stats that DO change with new activity,
    // so this stays shorter than the plain syllabus tree's staleTime.
    staleTime: 60_000,
  });
}

export function usePaperTrends(paperCode: string | undefined, exam?: ExamCode) {
  return useQuery({
    queryKey: queryKeys.paperTrends(paperCode ?? "", exam),
    queryFn: () => api.get(`/api/v1/syllabus/papers/${paperCode}/trends`, paperTrendsResponseSchema, { exam }),
    enabled: !!paperCode,
    staleTime: 60_000,
  });
}
