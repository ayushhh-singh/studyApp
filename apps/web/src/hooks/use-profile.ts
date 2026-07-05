import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileResponseSchema, type ProfileUpdateBody } from "@prayasup/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: () => api.get("/api/v1/profile", profileResponseSchema),
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
