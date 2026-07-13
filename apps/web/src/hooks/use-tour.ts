import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tourStateResponseSchema, type Profile, type TourUpdateBody } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** The two-stage checklist + feature-touch map (Dashboard card, /explore badges). */
export function useTourState(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.tourState(),
    queryFn: () => api.get("/api/v1/tour", tourStateResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateTourState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TourUpdateBody) => api.patch("/api/v1/tour", tourStateResponseSchema, body),
    onSuccess: (payload) => {
      queryClient.setQueryData(queryKeys.tourState(), payload);
      // RequireAuth's welcome/onboarding redirect reads tour_state off the
      // PROFILE cache, not this one — keep both in sync so a fresh
      // welcome_seen/dismissed write is visible immediately, not just after
      // the next full profile refetch (which would otherwise redirect-loop
      // back to /welcome for one more render).
      queryClient.setQueryData(queryKeys.profile(), (prev: Profile | undefined) =>
        prev ? { ...prev, tour_state: payload.tour_state } : prev,
      );
    },
  });
}
