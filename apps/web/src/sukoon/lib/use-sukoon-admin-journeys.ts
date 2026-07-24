/**
 * Sukoon F7 — admin content-queue data hooks for Guided Journeys, over
 * /api/sukoon/admin/*. Deliberately self-contained (its OWN /admin/status
 * probe, not Neev's `@/hooks/use-review`) so the Sukoon frontend module never
 * imports from a Neev feature module — see CLAUDE.md's isolation rule.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonAdminStatusResponseSchema,
  sukoonJourneyAdminListResponseSchema,
  sukoonJourneyAdminDetailResponseSchema,
  sukoonJourneyValidateResponseSchema,
  sukoonJourneyUpsertResponseSchema,
  type SukoonJourneyContent,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSukoonAdminStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonAdminStatus(),
    queryFn: () => api.get("/api/sukoon/admin/status", sukoonAdminStatusResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}

export function useAdminJourneys(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonAdminJourneys(),
    queryFn: () => api.get("/api/sukoon/admin/journeys", sukoonJourneyAdminListResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useAdminJourneyDetail(slug: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonAdminJourneyDetail(slug ?? ""),
    queryFn: () => api.get(`/api/sukoon/admin/journeys/${slug}`, sukoonJourneyAdminDetailResponseSchema),
    enabled: !!slug && (options?.enabled ?? true),
  });
}

/** POST /admin/journeys/validate — a dry run: `content` is unknown/raw (the
 *  admin's JSON.parse of a pasted/uploaded document), validated server-side. */
export function useValidateJourneyContent() {
  return useMutation({
    mutationFn: (content: unknown) =>
      api.post("/api/sukoon/admin/journeys/validate", sukoonJourneyValidateResponseSchema, { content }),
  });
}

/** POST /admin/journeys — upsert-by-slug; bumps version, never auto-publishes. */
export function useUpsertJourneyContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: SukoonJourneyContent) =>
      api.post("/api/sukoon/admin/journeys", sukoonJourneyUpsertResponseSchema, content),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonAdminJourneys() }),
  });
}

function usePublishAction(action: "publish" | "unpublish") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      api.post(`/api/sukoon/admin/journeys/${slug}/${action}`, sukoonJourneyUpsertResponseSchema),
    onSuccess: (_data, slug) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonAdminJourneys() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonAdminJourneyDetail(slug) });
      // The user-facing catalog visibility flips too — keep it in sync.
      void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJourneys() });
    },
  });
}

export const usePublishJourney = () => usePublishAction("publish");
export const useUnpublishJourney = () => usePublishAction("unpublish");
