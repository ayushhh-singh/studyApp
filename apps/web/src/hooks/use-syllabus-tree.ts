import { useQuery } from "@tanstack/react-query";
import { syllabusTreeResponseSchema, type ExamStage } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSyllabusTree(stage?: ExamStage) {
  return useQuery({
    queryKey: queryKeys.syllabusTree(stage),
    queryFn: () => api.get("/api/v1/syllabus/tree", syllabusTreeResponseSchema, { stage }),
  });
}
