/**
 * Sukoon billing service (F13, Session 10) — plans, server-side order creation
 * with the Neev-bundle discount, the one-time 7-day Pro trial, cancel, and the
 * signature-verified webhook state machine.
 *
 * Mirrors Neev's services/billing.ts ORDER-BASED design exactly (reusing Neev's
 * lib/razorpay.ts createRazorpayOrder + razorpayKeyId verbatim — the Razorpay
 * config is shared, the ONLY Razorpay identifiers live in env, nothing is
 * hardcoded here):
 *   - PRICE is data: every amount comes from sukoon_plans, never the client. The
 *     bundle discount is applied to the authoritative server-side amount.
 *   - A subscription's lifecycle is driven ONLY by signature-verified webhooks
 *     (never by the browser). checkout.js's success handler just triggers a
 *     re-fetch; the tier flip has already happened via the webhook.
 *   - Idempotent: every processed Razorpay event id is recorded in
 *     sukoon_billing_events; a replay finds its row and no-ops.
 *
 * Self-contained: writes only sukoon_ tables. The one cross-product read
 * (bundle eligibility) is the neev-bridge seam.
 */
import type {
  SukoonEntitlements,
  SukoonOrderData,
  SukoonPlan,
  SukoonSubscription,
} from "@neev/shared";
import { applyBundleDiscount } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError, badRequest } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { createRazorpayOrder, razorpayKeyId } from "../../lib/razorpay.js";
import { getSukoonEntitlements, hasUsedSukoonTrial } from "./entitlements.js";
import { hasActivePaidNeevPlan, getNeevDisplayName } from "../lib/neev-bridge.js";
import { recordSukoonEvent } from "./analytics.js";

const PLAN_COLUMNS =
  "id, code, tier, name_i18n, description_i18n, price_paise, currency, interval, interval_count, bundle_discount_pct, is_intro, sort_order";
const SUBSCRIPTION_COLUMNS =
  "id, plan_code, tier, status, amount_paise, currency, current_period_end, started_at, cancelled_at, is_trial, bundle_applied, created_at";

/** The one-time Sukoon trial length (blueprint §4 — mirror Neev's 7 days). */
export const SUKOON_TRIAL_DAYS = 7;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export async function listSukoonPlans(): Promise<SukoonPlan[]> {
  const { data, error } = await supabase()
    .from("sukoon_plans")
    .select(PLAN_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new HttpError(500, `sukoon plans lookup failed: ${error.message}`);
  return (data ?? []) as SukoonPlan[];
}

async function sukoonPlanByCode(code: string): Promise<SukoonPlan> {
  const { data, error } = await supabase()
    .from("sukoon_plans")
    .select(PLAN_COLUMNS)
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon plan lookup failed: ${error.message}`);
  if (!data) throw badRequest("Unknown or inactive Sukoon plan");
  return data as SukoonPlan;
}

// ---------------------------------------------------------------------------
// Subscription read (for the manage screen + gates)
// ---------------------------------------------------------------------------
/** The user's most recent Sukoon subscription row (any status), or null. */
export async function getLatestSukoonSubscription(userId: string): Promise<SukoonSubscription | null> {
  const { data, error } = await supabase()
    .from("sukoon_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon subscription lookup failed: ${error.message}`);
  return (data as SukoonSubscription | null) ?? null;
}

export async function getSukoonBillingState(
  userId: string,
): Promise<{ subscription: SukoonSubscription | null; entitlements: SukoonEntitlements }> {
  const [subscription, entitlements] = await Promise.all([
    getLatestSukoonSubscription(userId),
    getSukoonEntitlements(userId),
  ]);
  return { subscription, entitlements };
}

// ---------------------------------------------------------------------------
// Order creation (server-side, authoritative amount + bundle discount)
// ---------------------------------------------------------------------------
export async function createSukoonOrder(userId: string, planCode: string): Promise<SukoonOrderData> {
  const plan = await sukoonPlanByCode(planCode);

  // Bundle: an active PAID Neev plan → this plan's bundle_discount_pct off. The
  // discount is applied to the AUTHORITATIVE server amount (the client never
  // sends a price); bundle eligibility is re-checked server-side here, so the
  // client can never claim a discount it isn't entitled to.
  const bundleEligible = plan.bundle_discount_pct > 0 && (await hasActivePaidNeevPlan(userId));
  const amountPaise = bundleEligible
    ? applyBundleDiscount(plan.price_paise, plan.bundle_discount_pct)
    : plan.price_paise;

  // Create the subscription row first (status 'created') so we own the id used
  // as the Razorpay receipt + notes — the webhook resolves back to it. tier is
  // stamped now (from the plan) so activation needs no second plan lookup for it.
  const { data: sub, error: subError } = await supabase()
    .from("sukoon_subscriptions")
    .insert({
      user_id: userId,
      product: "sukoon",
      plan_id: plan.id,
      plan_code: plan.code,
      tier: plan.tier,
      status: "created",
      amount_paise: amountPaise,
      currency: plan.currency,
      bundle_applied: bundleEligible,
    })
    .select("id")
    .single();
  if (subError) throw new HttpError(500, `sukoon subscription create failed: ${subError.message}`);
  const subscriptionId = sub.id as string;

  let order;
  try {
    order = await createRazorpayOrder({
      amountPaise,
      currency: plan.currency,
      receipt: `sukoon_sub_${subscriptionId}`,
      // notes.product='sukoon' lets THIS module's webhook claim the event even
      // when a shared Razorpay account fans every event out to both Neev's and
      // Sukoon's webhook URLs (see processSukoonWebhookEvent).
      notes: {
        user_id: userId,
        plan_code: plan.code,
        subscription_id: subscriptionId,
        product: "sukoon",
        bundle: String(bundleEligible),
      },
    });
  } catch (err) {
    // Roll the placeholder row back so a failed order doesn't leave a dangling
    // 'created' subscription.
    await supabase().from("sukoon_subscriptions").delete().eq("id", subscriptionId);
    throw err;
  }

  const { error: updErr } = await supabase()
    .from("sukoon_subscriptions")
    .update({ razorpay_order_id: order.id })
    .eq("id", subscriptionId);
  if (updErr) throw new HttpError(500, `sukoon subscription order link failed: ${updErr.message}`);

  return {
    order_id: order.id,
    amount_paise: amountPaise,
    base_amount_paise: plan.price_paise,
    currency: plan.currency,
    key_id: razorpayKeyId(),
    plan,
    subscription_id: subscriptionId,
    bundle_applied: bundleEligible,
    prefill_name: await getNeevDisplayName(userId),
  };
}

// ---------------------------------------------------------------------------
// One-time 7-day Pro trial (separate Sukoon trial — independent of Neev's)
// ---------------------------------------------------------------------------
export async function startSukoonTrial(userId: string): Promise<SukoonSubscription> {
  if (await hasUsedSukoonTrial(userId)) {
    throw badRequest("You've already used your Sukoon free trial.");
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + SUKOON_TRIAL_DAYS);

  const { data, error } = await supabase()
    .from("sukoon_subscriptions")
    .insert({
      user_id: userId,
      product: "sukoon",
      tier: "pro", // full Pro during the trial
      status: "trialing",
      is_trial: true,
      amount_paise: 0,
      currency: "INR",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  if (error) {
    // 23505 = the one-trial-per-user unique index tripped a race — treat as
    // "already used" rather than a 500.
    if (error.code === "23505") throw badRequest("You've already used your Sukoon free trial.");
    throw new HttpError(500, `sukoon trial start failed: ${error.message}`);
  }
  logger.info({ userId, until: periodEnd.toISOString() }, "sukoon: started 7-day Pro trial");
  void recordSukoonEvent(userId, "trial_started", {});
  return data as SukoonSubscription;
}

// ---------------------------------------------------------------------------
// Cancel — end future continuation, KEEP access until period end. Data is never
// deleted on downgrade (the tier just lapses; every journal/mood/journey row
// stays). In this order-based (no-autopay) model there is no recurring mandate
// to stop — cancel is the user's explicit "don't continue", surfaced honestly.
// ---------------------------------------------------------------------------
export async function cancelSukoonSubscription(userId: string): Promise<SukoonSubscription> {
  // The current usable subscription (paid or trial), newest first.
  const { data: current, error: findErr } = await supabase()
    .from("sukoon_subscriptions")
    .select("id, status, current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new HttpError(500, `sukoon cancel lookup failed: ${findErr.message}`);
  if (!current) throw badRequest("You have no active Sukoon subscription to cancel.");

  const { data, error } = await supabase()
    .from("sukoon_subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", (current as { id: string }).id)
    .select(SUBSCRIPTION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `sukoon cancel failed: ${error.message}`);
  logger.info({ userId, subId: (current as { id: string }).id }, "sukoon: subscription cancelled (access until period end)");
  return data as SukoonSubscription;
}

// ---------------------------------------------------------------------------
// Webhook state machine (mirror of Neev's, over sukoon_ tables)
// ---------------------------------------------------------------------------
interface RazorpayEvent {
  event: string;
  payload: {
    payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, string> } };
    order?: { entity?: { id?: string; notes?: Record<string, string> } };
    subscription?: { entity?: { id?: string; notes?: Record<string, string> } };
  };
}

interface SubRow {
  id: string;
  user_id: string;
  plan_code: string | null;
  status: string;
  tier: string;
}

function eventNotes(evt: RazorpayEvent): Record<string, string> {
  return (
    evt.payload.payment?.entity?.notes ??
    evt.payload.order?.entity?.notes ??
    evt.payload.subscription?.entity?.notes ??
    {}
  );
}

/** Resolve the sukoon subscription an event refers to, by order id or notes.subscription_id. */
async function resolveSukoonSubscription(evt: RazorpayEvent): Promise<SubRow | null> {
  const orderId = evt.payload.payment?.entity?.order_id ?? evt.payload.order?.entity?.id ?? null;
  if (orderId) {
    const { data } = await supabase()
      .from("sukoon_subscriptions")
      .select("id, user_id, plan_code, status, tier")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (data) return data as SubRow;
  }
  const notesSubId = eventNotes(evt).subscription_id ?? null;
  if (notesSubId) {
    const { data } = await supabase()
      .from("sukoon_subscriptions")
      .select("id, user_id, plan_code, status, tier")
      .eq("id", notesSubId)
      .maybeSingle();
    if (data) return data as SubRow;
  }
  return null;
}

function addInterval(from: Date, interval: string, count: number): Date {
  const d = new Date(from);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + count);
  else d.setUTCMonth(d.getUTCMonth() + count);
  return d;
}

/** Mark the subscription active + set its paid period (tier was set at order time). */
async function activate(sub: SubRow, paymentId: string | undefined, now: Date): Promise<void> {
  if (sub.status === "active") return; // already activated (defensive)
  const plan = sub.plan_code ? await sukoonPlanByCode(sub.plan_code).catch(() => null) : null;
  const periodEnd = addInterval(now, plan?.interval ?? "month", plan?.interval_count ?? 1);

  const { error } = await supabase()
    .from("sukoon_subscriptions")
    .update({
      status: "active",
      razorpay_payment_id: paymentId ?? null,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      started_at: now.toISOString(), // the paid-vs-trial marker
    })
    .eq("id", sub.id);
  if (error) throw new HttpError(500, `sukoon subscription activate failed: ${error.message}`);
  logger.info({ userId: sub.user_id, subId: sub.id, tier: sub.tier, until: periodEnd.toISOString() }, "sukoon billing: activated");
  void recordSukoonEvent(sub.user_id, "subscription_activated", { tier: sub.tier });
}

/** Renewal (defensive — order-based has no autopay, so this rarely fires). */
async function renew(sub: SubRow, now: Date): Promise<void> {
  const plan = sub.plan_code ? await sukoonPlanByCode(sub.plan_code).catch(() => null) : null;
  const { data } = await supabase()
    .from("sukoon_subscriptions")
    .select("current_period_end")
    .eq("id", sub.id)
    .maybeSingle();
  const base = data?.current_period_end ? new Date(data.current_period_end as string) : now;
  const from = base > now ? base : now;
  const periodEnd = addInterval(from, plan?.interval ?? "month", plan?.interval_count ?? 1);
  await supabase()
    .from("sukoon_subscriptions")
    .update({ status: "active", current_period_end: periodEnd.toISOString() })
    .eq("id", sub.id);
  logger.info({ userId: sub.user_id, subId: sub.id, until: periodEnd.toISOString() }, "sukoon billing: renewed");
}

/** Cancellation via webhook: keep access until period end (lazy downgrade). */
async function cancelViaWebhook(sub: SubRow, now: Date): Promise<void> {
  await supabase()
    .from("sukoon_subscriptions")
    .update({ status: "cancelled", cancelled_at: now.toISOString() })
    .eq("id", sub.id);
  logger.info({ userId: sub.user_id, subId: sub.id }, "sukoon billing: cancelled via webhook (access until period end)");
}

/** Failed initial payment: mark failed; no tier change (never unwinds a paid sub). */
async function fail(sub: SubRow): Promise<void> {
  if (sub.status === "active") return;
  await supabase().from("sukoon_subscriptions").update({ status: "failed" }).eq("id", sub.id);
  logger.info({ userId: sub.user_id, subId: sub.id }, "sukoon billing: payment failed");
}

export interface WebhookResult {
  handled: boolean;
  duplicate: boolean;
  event: string;
}

/**
 * Process a verified webhook. Signature verification happens at the route (raw
 * bytes); this does the idempotent state transition. On a shared Razorpay
 * account both Neev's and Sukoon's webhook URLs receive EVERY event — this
 * handler ignores any event that neither resolves to a sukoon subscription NOR
 * carries notes.product='sukoon', so a Neev event reaching here is a clean
 * no-op that doesn't even pollute sukoon_billing_events.
 */
export async function processSukoonWebhookEvent(eventId: string, evt: RazorpayEvent): Promise<WebhookResult> {
  const sub = await resolveSukoonSubscription(evt);
  const product = eventNotes(evt).product;
  if (!sub && product !== "sukoon") {
    // Not ours (e.g. a Neev event on the shared-account webhook). Ignore silently.
    return { handled: false, duplicate: false, event: evt.event };
  }

  // Idempotency: claim the event id. A replay hits the unique index (23505) and
  // returns duplicate=true without re-running any side effect.
  const { error: insErr } = await supabase().from("sukoon_billing_events").insert({
    razorpay_event_id: eventId,
    event_type: evt.event,
    subscription_id: sub?.id ?? null,
    payload: evt as unknown as Record<string, unknown>,
  });
  if (insErr) {
    if (insErr.code === "23505") return { handled: false, duplicate: true, event: evt.event };
    throw new HttpError(500, `sukoon billing event record failed: ${insErr.message}`);
  }

  const now = new Date();
  if (!sub) {
    logger.warn({ event: evt.event }, "sukoon billing: webhook tagged product=sukoon but no resolvable subscription");
    return { handled: false, duplicate: false, event: evt.event };
  }

  // The idempotency row was written BEFORE the transition; if the transition
  // throws, roll it back so Razorpay's retry can re-process (otherwise the retry
  // would be treated as a duplicate and the paid user never activated).
  try {
    switch (evt.event) {
      case "payment.captured":
      case "order.paid":
        await activate(sub, evt.payload.payment?.entity?.id, now);
        break;
      case "payment.failed":
        await fail(sub);
        break;
      case "subscription.charged":
        await renew(sub, now);
        break;
      case "subscription.cancelled":
      case "subscription.halted":
        await cancelViaWebhook(sub, now);
        break;
      default:
        logger.info({ event: evt.event }, "sukoon billing: unhandled webhook event (recorded)");
        return { handled: false, duplicate: false, event: evt.event };
    }
  } catch (err) {
    await supabase().from("sukoon_billing_events").delete().eq("razorpay_event_id", eventId);
    throw err;
  }
  return { handled: true, duplicate: false, event: evt.event };
}
