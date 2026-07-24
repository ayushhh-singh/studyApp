import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import {
  sukoonTierSchema,
  sukoonChatUsageSchema,
  sukoonReflectionUsageSchema,
} from "./sukoon";

/**
 * Sukoon billing (F13, Session 10) shared contract. Kept in its OWN file (not
 * folded into sukoon.ts) purely for module tidiness — it composes the tier/chat/
 * reflection vocabulary already defined there. Standalone-extractable: this file
 * moves with sukoon.ts if Sukoon is ever split out.
 *
 * The flow mirrors Neev's billing exactly (ORDER-BASED — one-time Razorpay
 * orders with a server-authoritative amount + a signature-verified webhook state
 * machine, NOT the Razorpay Subscriptions/autopay API). The only Sukoon-specific
 * twists: three tiers (free/plus/pro) instead of free/pro, a separate one-time
 * 7-day Pro trial, and the Neev-bundle 40%-off discount applied server-side.
 */

// ---------------------------------------------------------------------------
// Plans (the sukoon_plans catalog — price is DATA, not code)
// ---------------------------------------------------------------------------
export const sukoonPlanIntervalSchema = z.enum(["month", "year"]);
export type SukoonPlanInterval = z.infer<typeof sukoonPlanIntervalSchema>;

/** A paid Sukoon plan tier — never 'free' (free = no subscription). */
export const sukoonPaidTierSchema = z.enum(["plus", "pro"]);
export type SukoonPaidTier = z.infer<typeof sukoonPaidTierSchema>;

export const sukoonPlanSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  tier: sukoonPaidTierSchema,
  name_i18n: bilingualTextSchema,
  description_i18n: bilingualTextSchema,
  price_paise: z.number().int(),
  currency: z.string(),
  interval: sukoonPlanIntervalSchema,
  interval_count: z.number().int(),
  /** The Neev-bundle discount % this plan offers a bundle-eligible user (0 = none). */
  bundle_discount_pct: z.number().int(),
  is_intro: z.boolean(),
  sort_order: z.number().int(),
});
export type SukoonPlan = z.infer<typeof sukoonPlanSchema>;

/**
 * GET /billing/plans — the catalog plus whether THIS user qualifies for the
 * Neev bundle (an active paid Neev plan), so the pricing page can show the
 * discounted prices inline. `bundle_eligible` is always false in standalone
 * mode (there is no Neev to bundle with).
 */
export const sukoonPlansResponseSchema = apiEnvelopeSchema(
  z.object({
    plans: z.array(sukoonPlanSchema),
    bundle_eligible: z.boolean(),
    bundle_discount_pct: z.number().int(),
  }),
);
export type SukoonPlansResponse = z.infer<typeof sukoonPlansResponseSchema>;

// ---------------------------------------------------------------------------
// Subscription (a user's Sukoon billing state)
// ---------------------------------------------------------------------------
export const sukoonSubscriptionStatusSchema = z.enum([
  "created",
  "active",
  "cancelled",
  "expired",
  "failed",
  "trialing",
]);
export type SukoonSubscriptionStatus = z.infer<typeof sukoonSubscriptionStatusSchema>;

export const sukoonSubscriptionSchema = z.object({
  id: z.string().uuid(),
  plan_code: z.string().nullable(),
  tier: sukoonTierSchema,
  status: sukoonSubscriptionStatusSchema,
  amount_paise: z.number().int().nullable(),
  currency: z.string(),
  current_period_end: z.string().nullable(),
  started_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  is_trial: z.boolean(),
  bundle_applied: z.boolean(),
  created_at: z.string(),
});
export type SukoonSubscription = z.infer<typeof sukoonSubscriptionSchema>;

// ---------------------------------------------------------------------------
// Entitlements snapshot — the ONE object the Sukoon UI reads for the plan row,
// paywall copy, and every premium gate. Composed from getSukoonTier + the
// existing chat/reflection meters + the tier→features map (server-resolved).
// ---------------------------------------------------------------------------

/**
 * Where the effective tier comes from — the UI copy differs by source:
 *   free  → the Free tier (upsell to Plus/Pro).
 *   trial → the 7-day Pro trial (show a countdown + "resets"/"keep Pro").
 *   paid  → a paid Plus/Pro subscription (show the plan + manage).
 */
export const sukoonTierSourceSchema = z.enum(["free", "trial", "paid"]);
export type SukoonTierSource = z.infer<typeof sukoonTierSourceSchema>;

/** Boolean premium gates, resolved server-side from the effective tier. */
export const sukoonFeatureFlagsSchema = z.object({
  /** AI journal reflections (Plus+). */
  ai_reflections: z.boolean(),
  /** Premium guided journeys (Plus+; the single free journey is always open). */
  all_journeys: z.boolean(),
  /** Weekly insights report (Plus+). */
  weekly_insights: z.boolean(),
  /** The full guided-meditation library (Plus+). */
  meditation_library: z.boolean(),
  /** Voice-note journal (Plus+). */
  voice_note_journal: z.boolean(),
  /** Voice Mode conversations (Pro). */
  voice_mode: z.boolean(),
  /** Deep insights — journal-body-aware weekly insights (Pro, opt-in). */
  deep_insights: z.boolean(),
  /** Sonnet-priority deep conversations (Pro). */
  priority_conversations: z.boolean(),
});
export type SukoonFeatureFlags = z.infer<typeof sukoonFeatureFlagsSchema>;

export const sukoonEntitlementsSchema = z.object({
  tier: sukoonTierSchema,
  tier_source: sukoonTierSourceSchema,
  /** True on the 7-day Pro trial (tier is 'pro' but no paid subscription behind it). */
  is_on_trial: z.boolean(),
  /** When the current trial/paid period ends (null for Free). */
  current_period_end: z.string().nullable(),
  /** Whether the user can still START a (one-time) Sukoon trial. */
  trial_eligible: z.boolean(),
  /** Whether an active paid Neev plan qualifies this user for the 40%-off bundle. */
  bundle_eligible: z.boolean(),
  bundle_discount_pct: z.number().int(),
  /** Today's chat allowance (mirrors GET /chat/usage). */
  chat: sukoonChatUsageSchema,
  /** The AI-reflection allowance (mirrors GET /journal/reflection/usage). */
  reflections: sukoonReflectionUsageSchema,
  features: sukoonFeatureFlagsSchema,
});
export type SukoonEntitlements = z.infer<typeof sukoonEntitlementsSchema>;

/** GET /billing/subscription — the manage screen + every gate read from here. */
export const sukoonBillingStateResponseSchema = apiEnvelopeSchema(
  z.object({
    subscription: sukoonSubscriptionSchema.nullable(),
    entitlements: sukoonEntitlementsSchema,
  }),
);
export type SukoonBillingStateResponse = z.infer<typeof sukoonBillingStateResponseSchema>;

/** GET /billing/entitlements — the lightweight snapshot (no subscription row). */
export const sukoonEntitlementsResponseSchema = apiEnvelopeSchema(sukoonEntitlementsSchema);
export type SukoonEntitlementsResponse = z.infer<typeof sukoonEntitlementsResponseSchema>;

// ---------------------------------------------------------------------------
// Order creation (server-side, authoritative amount) → drives checkout.js
// ---------------------------------------------------------------------------
export const sukoonCreateOrderBodySchema = z.object({
  plan_code: z.string().min(1),
});
export type SukoonCreateOrderBody = z.infer<typeof sukoonCreateOrderBodySchema>;

export const sukoonOrderDataSchema = z.object({
  order_id: z.string(),
  /** The amount actually charged (bundle discount already applied). */
  amount_paise: z.number().int(),
  /** The plan's list price before any bundle discount (for a struck-through display). */
  base_amount_paise: z.number().int(),
  currency: z.string(),
  key_id: z.string(),
  plan: sukoonPlanSchema,
  subscription_id: z.string().uuid(),
  /** Whether the Neev-bundle discount was applied to this order. */
  bundle_applied: z.boolean(),
  prefill_name: z.string().nullable(),
});
export type SukoonOrderData = z.infer<typeof sukoonOrderDataSchema>;

export const sukoonCreateOrderResponseSchema = apiEnvelopeSchema(sukoonOrderDataSchema);
export type SukoonCreateOrderResponse = z.infer<typeof sukoonCreateOrderResponseSchema>;

// ---------------------------------------------------------------------------
// Trial + cancel
// ---------------------------------------------------------------------------
/** POST /billing/trial — start the one-time 7-day Pro trial. Returns the trialing row. */
export const sukoonTrialResponseSchema = apiEnvelopeSchema(
  z.object({ subscription: sukoonSubscriptionSchema }),
);
export type SukoonTrialResponse = z.infer<typeof sukoonTrialResponseSchema>;

/**
 * POST /billing/cancel — stop the current subscription from continuing while
 * KEEPING access until the period ends (end-of-period access; data is never
 * deleted). Returns the updated row.
 */
export const sukoonCancelResponseSchema = apiEnvelopeSchema(
  z.object({ subscription: sukoonSubscriptionSchema }),
);
export type SukoonCancelResponse = z.infer<typeof sukoonCancelResponseSchema>;

// ---------------------------------------------------------------------------
// Display helpers (pure) — shared so the Sukoon pricing page and the Neev
// "+ Sukoon" bundle strip format money identically.
// ---------------------------------------------------------------------------
/** Rupee string for display, e.g. 9900 → "99". Matches Neev's paiseToRupeeString. */
export function sukoonPaiseToRupees(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** How many months a plan bills for (yearly = 12), for the "≈ ₹X/mo" sub-label. */
export function sukoonPlanMonths(plan: Pick<SukoonPlan, "interval" | "interval_count">): number {
  return plan.interval === "year" ? 12 * plan.interval_count : plan.interval_count;
}

/** Apply a whole-percent discount to a paise amount, rounded to the nearest rupee. */
export function applyBundleDiscount(pricePaise: number, discountPct: number): number {
  if (discountPct <= 0) return pricePaise;
  const discounted = pricePaise * (1 - discountPct / 100);
  // Round to the nearest whole rupee so the charged amount is clean (₹59, not ₹59.40).
  return Math.round(discounted / 100) * 100;
}
