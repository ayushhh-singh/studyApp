/**
 * Sukoon F11 — Garden data hook, mirrors use-sukoon-mood.ts's conventions. A
 * single cheap read; the three mutations that actually GROW the garden (mood
 * check-in, a completed exercise session, a new journal entry) each also
 * invalidate `queryKeys.sukoonGarden()` at their own call sites, so the Home
 * card reflects new growth right away instead of waiting for an unrelated
 * refocus/remount to refetch it.
 */
import { useQuery } from "@tanstack/react-query";
import { sukoonGardenResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useGardenState(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonGarden(),
    queryFn: () => api.get("/api/sukoon/garden", sukoonGardenResponseSchema),
    enabled: options?.enabled ?? true,
  });
}
