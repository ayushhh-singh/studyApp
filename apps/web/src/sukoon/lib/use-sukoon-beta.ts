import { useQuery } from "@tanstack/react-query";
import { sukoonBetaStatusResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/providers/auth-provider";

/**
 * Session 14 — SUKOON_BETA_COHORT status. Deliberately placed under
 * apps/web/src/sukoon/lib (not a Neev lib file) even though Neev's own nav
 * components (sidebar/bottom-tab-bar/command-palette/landing) import it — the
 * module isolation rule is "Neev may import from Sukoon, never the reverse",
 * so this direction is fine and keeps every Sukoon-owned concept in one place.
 */
export function useSukoonBetaStatus(options?: { enabled?: boolean }) {
  const { session } = useAuth();
  return useQuery({
    queryKey: queryKeys.sukoonBetaStatus(),
    queryFn: () => api.get("/api/sukoon/beta/status", sukoonBetaStatusResponseSchema),
    enabled: (options?.enabled ?? true) && !!session,
    staleTime: 5 * 60_000,
  });
}

/**
 * `true` once we know the user should see the two access points (homepage
 * card, in-app nav item). Defaults to `false` while unresolved/signed-out —
 * never flashes the entry point on for a beat before hiding it again.
 */
export function useSukoonBetaVisible(): boolean {
  const { session } = useAuth();
  const query = useSukoonBetaStatus({ enabled: !!session });
  if (!session) return false;
  return query.data?.in_cohort ?? false;
}
