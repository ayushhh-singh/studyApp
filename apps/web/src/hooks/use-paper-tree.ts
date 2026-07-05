import { useQuery } from "@tanstack/react-query";
import { paperTreeResponseSchema } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function usePaperTree(paperCode: string | undefined) {
  return useQuery({
    queryKey: queryKeys.paperTree(paperCode ?? ""),
    queryFn: () => api.get(`/api/v1/syllabus/papers/${paperCode}/tree`, paperTreeResponseSchema),
    enabled: !!paperCode,
  });
}
