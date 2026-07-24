import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonProfileResponseSchema,
  sukoonProfileWriteResponseSchema,
  type SukoonOnboardingBody,
  type SukoonProfileUpdateBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * The signed-in user's Sukoon profile. `data.profile` is null before onboarding
 * (a normal, expected state, not an error) — the onboarding gate reads that to
 * redirect. Pass `enabled: false` while there's no session so we don't fire a
 * doomed unauthenticated request (Sukoon pages are reachable pre-login).
 */
export function useSukoonProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonProfile(),
    queryFn: () => api.get("/api/sukoon/profile", sukoonProfileResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useCompleteSukoonOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SukoonOnboardingBody) =>
      api.post("/api/sukoon/onboarding", sukoonProfileWriteResponseSchema, body),
    onSuccess: (profile) => {
      // Match the GET shape ({ profile }) so the gate sees the fresh profile
      // immediately and lets the app render without a refetch round-trip.
      queryClient.setQueryData(queryKeys.sukoonProfile(), { profile });
    },
  });
}

/** PATCH /profile — the Settings screen's notification-preference toggles
 *  (and any other user-editable field) go through this one mutation. */
export function useUpdateSukoonProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SukoonProfileUpdateBody) =>
      api.patch("/api/sukoon/profile", sukoonProfileWriteResponseSchema, body),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.sukoonProfile(), { profile });
    },
  });
}
