import { useQuery } from "@tanstack/react-query";
import { syllabusNodeDetailResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSyllabusNode(nodeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.syllabusNode(nodeId ?? ""),
    queryFn: () => api.get(`/api/v1/syllabus/nodes/${nodeId}`, syllabusNodeDetailResponseSchema),
    enabled: !!nodeId,
  });
}
