import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonBillingStateResponseSchema,
  sukoonCancelResponseSchema,
  sukoonCreateOrderResponseSchema,
  sukoonEntitlementsResponseSchema,
  sukoonPlansResponseSchema,
  sukoonTrialResponseSchema,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Sukoon billing (F13) TanStack Query hooks — mirror Neev's use-billing.ts,
 * against the /api/sukoon/billing/* endpoints. The tier flip is webhook-driven,
 * so the purchase flow just re-fetches after checkout (never trusts the browser).
 */

/** The Sukoon plan catalog + this user's bundle eligibility. */
export function useSukoonPlans(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonBillingPlans(),
    queryFn: () => api.get("/api/sukoon/billing/plans", sukoonPlansResponseSchema),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true,
  });
}

/** Current subscription row + full entitlements (the manage screen's read). */
export function useSukoonBillingState(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonBillingState(),
    queryFn: () => api.get("/api/sukoon/billing/subscription", sukoonBillingStateResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

/** The lightweight entitlements snapshot (tier, caps, features, trial/bundle). */
export function useSukoonEntitlements(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonEntitlements(),
    queryFn: () => api.get("/api/sukoon/billing/entitlements", sukoonEntitlementsResponseSchema),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

/** Create a Razorpay order for a plan (server prices it, applying the bundle). */
export function useCreateSukoonOrder() {
  return useMutation({
    mutationFn: (planCode: string) =>
      api.post("/api/sukoon/billing/order", sukoonCreateOrderResponseSchema, { plan_code: planCode }),
  });
}

/** Start the one-time 7-day Pro trial. */
export function useStartSukoonTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/sukoon/billing/trial", sukoonTrialResponseSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sukoon", "billing"] }),
  });
}

/** Cancel — stop continuation, keep access until period end. */
export function useCancelSukoonSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/sukoon/billing/cancel", sukoonCancelResponseSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sukoon", "billing"] }),
  });
}

/** Invalidate every Sukoon billing query (after a purchase completes). */
export function useRefreshSukoonBilling() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["sukoon", "billing"] });
    // The chat/reflection meters read the tier too — refresh them so a new plan
    // lifts the "N left" caps immediately.
    void qc.invalidateQueries({ queryKey: queryKeys.sukoonChatUsage() });
    void qc.invalidateQueries({ queryKey: queryKeys.sukoonReflectionUsage() });
  };
}
