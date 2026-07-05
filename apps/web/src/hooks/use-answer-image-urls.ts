import { useQuery } from "@tanstack/react-query";
import { getAnswerImageUrl } from "@/lib/answer-images";

/** Short-lived signed thumbnail URLs for a handwritten submission's stored page images. */
export function useAnswerImageUrls(paths: string[] | null | undefined) {
  const key = paths?.join(",") ?? "";
  return useQuery({
    queryKey: ["answer-image-urls", key],
    queryFn: () => Promise.all((paths ?? []).map((p) => getAnswerImageUrl(p))),
    enabled: !!paths?.length,
    staleTime: 30 * 60 * 1000,
  });
}
