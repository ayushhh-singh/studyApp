import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileResponseSchema, type OnboardingBody, type ProfileUpdateBody } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: () => api.get("/api/v1/profile", profileResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdateBody) => api.patch("/api/v1/profile", profileResponseSchema, body),
    onSuccess: (profile, variables) => {
      queryClient.setQueryData(queryKeys.profile(), profile);
      // Leaving/rejoining the Mains board must reflect immediately in
      // whichever board the user is currently looking at — otherwise
      // "Leave the Mains board" appears to do nothing until some unrelated
      // refetch happens to land. Scoped to this one field so an unrelated
      // profile edit (display name, locale, ...) doesn't refetch scoreboard
      // data for no reason.
      if (variables.show_on_mains_board !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.scoreboardMainsWeekly() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.scoreboardMainsEssay() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.scoreboardDimensionBests() });
      }
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OnboardingBody) => api.post("/api/v1/profile/onboarding", profileResponseSchema, body),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile(), profile);
    },
  });
}
