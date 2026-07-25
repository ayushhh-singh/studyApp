/**
 * Sukoon F12 — Privacy Center data hooks (TanStack Query over /api/sukoon/privacy).
 * The summary drives the whole page; export is a poll-until-ready job; delete /
 * cancel / withdraw mutate the account state and refresh the summary.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonPrivacySummaryResponseSchema,
  sukoonExportJobResponseSchema,
  sukoonExportDownloadResponseSchema,
  sukoonAccountStateResponseSchema,
  type SukoonExportArtifact,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useSukoonPrivacySummary(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonPrivacySummary(),
    queryFn: () => api.get("/api/sukoon/privacy/summary", sukoonPrivacySummaryResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

/**
 * The latest export job. While a job is pending/processing we poll every few
 * seconds so the card flips to "ready" on its own.
 */
export function useSukoonLatestExport(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonExportLatest(),
    queryFn: () => api.get("/api/sukoon/privacy/export", sukoonExportJobResponseSchema),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  });
}

export function useRequestSukoonExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/sukoon/privacy/export", sukoonExportJobResponseSchema),
    onSuccess: (job) => {
      qc.setQueryData(queryKeys.sukoonExportLatest(), job);
      void qc.invalidateQueries({ queryKey: queryKeys.sukoonPrivacySummary() });
    },
  });
}

/** Fetch a fresh signed download URL for a ready artifact and open it. */
export function fetchSukoonExportUrl(jobId: string, artifact: SukoonExportArtifact) {
  return api.get(
    `/api/sukoon/privacy/export/${jobId}/download`,
    sukoonExportDownloadResponseSchema,
    { artifact },
  );
}

function refreshPrivacy(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.sukoonPrivacySummary() });
  // The whole app's Sukoon data may now be gated (deletion) or restored — let
  // every Sukoon query re-fetch so the UI reflects the new account state.
  void qc.invalidateQueries({ queryKey: ["sukoon"] });
}

export function useDeleteSukoonAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post("/api/sukoon/privacy/delete", sukoonAccountStateResponseSchema, { confirm: true }),
    onSuccess: () => refreshPrivacy(qc),
  });
}

export function useCancelSukoonDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/sukoon/privacy/delete/cancel", sukoonAccountStateResponseSchema),
    onSuccess: () => refreshPrivacy(qc),
  });
}

export function useWithdrawSukoonConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post("/api/sukoon/privacy/consent/withdraw", sukoonAccountStateResponseSchema, {
        confirm: true,
      }),
    onSuccess: () => refreshPrivacy(qc),
  });
}
