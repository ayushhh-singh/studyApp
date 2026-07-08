import { useQuery } from "@tanstack/react-query";
import { syllabusNodeDetailResponseSchema, type ExamCode } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSyllabusNode(nodeId: string | undefined, exam?: ExamCode) {
  return useQuery({
    queryKey: queryKeys.syllabusNode(nodeId ?? "", exam),
    queryFn: () => api.get(`/api/v1/syllabus/nodes/${nodeId}`, syllabusNodeDetailResponseSchema, { exam }),
    enabled: !!nodeId,
    staleTime: 60_000,
  });
}
