import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { userPlanSchema } from "./profile";

// ---------------------------------------------------------------------------
// Plans (priceable products — the DB `plans` table)
// ---------------------------------------------------------------------------
export const planIntervalSchema = z.enum(["month", "year"]);
export type PlanInterval = z.infer<typeof planIntervalSchema>;

export const planSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  tier: userPlanSchema,
  name_i18n: bilingualTextSchema,
  description_i18n: bilingualTextSchema,
  price_paise: z.number().int(),
  currency: z.string(),
  interval: planIntervalSchema,
  interval_count: z.number().int(),
  is_intro: z.boolean(),
  sort_order: z.number().int(),
});
export type Plan = z.infer<typeof planSchema>;

export const plansResponseSchema = apiEnvelopeSchema(z.object({ plans: z.array(planSchema) }));
export type PlansResponse = z.infer<typeof plansResponseSchema>;

// ---------------------------------------------------------------------------
// Subscription (a user's billing state)
// ---------------------------------------------------------------------------
export const subscriptionStatusSchema = z.enum([
  "created",
  "active",
  "cancelled",
  "expired",
  "failed",
  "halted",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  plan_code: z.string().nullable(),
  status: subscriptionStatusSchema,
  amount_paise: z.number().int().nullable(),
  currency: z.string(),
  current_period_end: z.string().nullable(),
  started_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  created_at: z.string(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

// ---------------------------------------------------------------------------
// Entitlements snapshot (what the UI reads to draw quota chips + gates)
// ---------------------------------------------------------------------------
/** A metered allowance. `unlimited` fixed periods still report used/remaining. */
export const quotaSchema = z.object({
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
  /** billing window the counter resets on */
  period: z.enum(["lifetime", "month", "day"]),
});
export type Quota = z.infer<typeof quotaSchema>;

export const entitlementsSchema = z.object({
  plan: userPlanSchema,
  plan_expires_at: z.string().nullable(),
  /**
   * On the 7-day Pro free trial: plan is 'pro' (full features) but with tighter
   * daily caps and no paid subscription behind it. The UI reads this to show a
   * trial countdown and the "resets tomorrow" (not "upgrade") eval messaging.
   */
  is_on_trial: z.boolean(),
  evaluations: quotaSchema,
  mentor_messages: quotaSchema,
  /** Boolean feature flags (Pro-only surfaces). */
  features: z.object({
    handwritten_ocr: z.boolean(),
    micro_drills: z.boolean(),
    mock_tests: z.boolean(),
    all_notes: z.boolean(),
    advanced_analytics: z.boolean(),
    magazine_pdf: z.boolean(),
  }),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const entitlementsResponseSchema = apiEnvelopeSchema(entitlementsSchema);
export type EntitlementsResponse = z.infer<typeof entitlementsResponseSchema>;

// ---------------------------------------------------------------------------
// Order creation (server-side) → drives Razorpay checkout.js in the SPA
// ---------------------------------------------------------------------------
export const createOrderBodySchema = z.object({
  plan_code: z.string().min(1),
});
export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

export const orderDataSchema = z.object({
  order_id: z.string(),
  amount_paise: z.number().int(),
  currency: z.string(),
  key_id: z.string(),
  plan: planSchema,
  subscription_id: z.string().uuid(),
  /** so checkout.js can prefill the customer */
  prefill_name: z.string().nullable(),
});
export type OrderData = z.infer<typeof orderDataSchema>;

export const createOrderResponseSchema = apiEnvelopeSchema(orderDataSchema);
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const subscriptionResponseSchema = apiEnvelopeSchema(
  z.object({ subscription: subscriptionSchema.nullable(), entitlements: entitlementsSchema }),
);
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

/** Rupee string for display, e.g. 149900 → "1,499". */
export function paiseToRupeeString(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
