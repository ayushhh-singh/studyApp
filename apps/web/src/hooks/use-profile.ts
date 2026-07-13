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
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile(), profile);
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
