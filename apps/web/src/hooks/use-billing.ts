import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrderResponseSchema,
  entitlementsResponseSchema,
  plansResponseSchema,
  subscriptionResponseSchema,
} from "@prayasup/shared";
import { api } from "@/lib/api";

// Query keys kept local to the billing feature (self-contained).
export const billingKeys = {
  entitlements: () => ["billing", "entitlements"] as const,
  plans: () => ["billing", "plans"] as const,
  subscription: () => ["billing", "subscription"] as const,
};

/** The entitlement snapshot: plan, eval/mentor quotas, Pro feature flags. */
export function useEntitlements(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: billingKeys.entitlements(),
    queryFn: () => api.get("/api/v1/entitlements", entitlementsResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/** Active plans (pricing lives in the DB). */
export function usePlans() {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: () => api.get("/api/v1/billing/plans", plansResponseSchema),
    staleTime: 5 * 60_000,
  });
}

/** Current subscription + entitlements (for the pricing page's current-plan banner). */
export function useBillingSubscription() {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: () => api.get("/api/v1/billing/subscription", subscriptionResponseSchema),
    staleTime: 30_000,
  });
}

/** Create a Razorpay order server-side for a plan. */
export function useCreateOrder() {
  return useMutation({
    mutationFn: (planCode: string) =>
      api.post("/api/v1/billing/order", createOrderResponseSchema, { plan_code: planCode }),
  });
}

/** After a successful payment, refresh everything gated by plan. */
export function useRefreshBilling() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["billing"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
  };
}
