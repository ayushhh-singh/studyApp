/**
 * Billing service — plans, server-side order creation, and the webhook state
 * machine.
 *
 * Design invariants:
 *  - PRICE is data: every amount comes from the `plans` table, never the client.
 *  - A subscription's lifecycle is driven ONLY by signature-verified webhooks
 *    (never by the browser telling us "payment succeeded"). The client's
 *    checkout.js success handler just triggers a re-fetch; the plan flip has
 *    already happened (or will) via the webhook.
 *  - Idempotent: every processed Razorpay event id is recorded in
 *    billing_events; a replay finds its row and no-ops.
 */
import type {
  Entitlements,
  OrderData,
  Plan,
  Subscription,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { createRazorpayOrder, razorpayKeyId } from "../lib/razorpay.js";
import { getEntitlements } from "./entitlements.js";

const PLAN_COLUMNS =
  "id, code, tier, name_i18n, description_i18n, price_paise, currency, interval, interval_count, is_intro, sort_order";
const SUBSCRIPTION_COLUMNS =
  "id, plan_code, status, amount_paise, currency, current_period_end, started_at, cancelled_at, created_at";

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await supabase()
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new HttpError(500, `plans lookup failed: ${error.message}`);
  return (data ?? []) as Plan[];
}

async function planByCode(code: string): Promise<Plan> {
  const { data, error } = await supabase()
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new HttpError(500, `plan lookup failed: ${error.message}`);
  if (!data) throw badRequest("Unknown or inactive plan");
  return data as Plan;
}

// ---------------------------------------------------------------------------
// Subscription read (for the UI)
// ---------------------------------------------------------------------------
/** The user's most recent subscription row (any status), or null. */
export async function getLatestSubscription(userId: string): Promise<Subscription | null> {
  const { data, error } = await supabase()
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `subscription lookup failed: ${error.message}`);
  return (data as Subscription | null) ?? null;
}

export async function getBillingState(
  userId: string,
): Promise<{ subscription: Subscription | null; entitlements: Entitlements }> {
  const [subscription, entitlements] = await Promise.all([
    getLatestSubscription(userId),
    getEntitlements(userId),
  ]);
  return { subscription, entitlements };
}

// ---------------------------------------------------------------------------
// Order creation (server-side, authoritative amount)
// ---------------------------------------------------------------------------
export async function createOrder(userId: string, planCode: string): Promise<OrderData> {
  const plan = await planByCode(planCode);

  // Create the subscription row first (status 'created') so we own the id used
  // as the Razorpay receipt + notes — the webhook resolves back to it.
  const { data: sub, error: subError } = await supabase()
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      plan_code: plan.code,
      status: "created",
      amount_paise: plan.price_paise,
      currency: plan.currency,
    })
    .select("id")
    .single();
  if (subError) throw new HttpError(500, `subscription create failed: ${subError.message}`);
  const subscriptionId = sub.id as string;

  let order;
  try {
    order = await createRazorpayOrder({
      amountPaise: plan.price_paise,
      currency: plan.currency,
      receipt: `sub_${subscriptionId}`,
      notes: { user_id: userId, plan_code: plan.code, subscription_id: subscriptionId },
    });
  } catch (err) {
    // Roll the placeholder row back so a failed order doesn't leave a dangling
    // 'created' subscription.
    await supabase().from("subscriptions").delete().eq("id", subscriptionId);
    throw err;
  }

  const { error: updErr } = await supabase()
    .from("subscriptions")
    .update({ razorpay_order_id: order.id })
    .eq("id", subscriptionId);
  if (updErr) throw new HttpError(500, `subscription order link failed: ${updErr.message}`);

  const { data: profile } = await supabase()
    .from("users_profile")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    order_id: order.id,
    amount_paise: plan.price_paise,
    currency: plan.currency,
    key_id: razorpayKeyId(),
    plan,
    subscription_id: subscriptionId,
    prefill_name: (profile?.display_name as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Webhook state machine
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
}

/** Resolve the subscription an event refers to, by order id or notes.subscription_id. */
async function resolveSubscription(evt: RazorpayEvent): Promise<SubRow | null> {
  const orderId = evt.payload.payment?.entity?.order_id ?? evt.payload.order?.entity?.id ?? null;
  if (orderId) {
    const { data } = await supabase()
      .from("subscriptions")
      .select("id, user_id, plan_code, status")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (data) return data as SubRow;
  }
  const notesSubId =
    evt.payload.payment?.entity?.notes?.subscription_id ??
    evt.payload.order?.entity?.notes?.subscription_id ??
    evt.payload.subscription?.entity?.notes?.subscription_id ??
    null;
  if (notesSubId) {
    const { data } = await supabase()
      .from("subscriptions")
      .select("id, user_id, plan_code, status")
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

/** Mark the subscription active, set the period, and flip the user to Pro. */
async function activate(sub: SubRow, paymentId: string | undefined, now: Date): Promise<void> {
  if (sub.status === "active") return; // already activated (defensive)
  const plan = sub.plan_code ? await planByCode(sub.plan_code).catch(() => null) : null;
  const periodEnd = addInterval(now, plan?.interval ?? "month", plan?.interval_count ?? 1);

  const { error: subErr } = await supabase()
    .from("subscriptions")
    .update({
      status: "active",
      razorpay_payment_id: paymentId ?? null,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      started_at: now.toISOString(),
    })
    .eq("id", sub.id);
  if (subErr) throw new HttpError(500, `subscription activate failed: ${subErr.message}`);

  // Never shorten an existing Pro grant: if the user already had Pro expiring
  // later (e.g. an early re-purchase while still active), keep the later date.
  const { data: prof } = await supabase().from("users_profile").select("plan_expires_at").eq("id", sub.user_id).maybeSingle();
  const existing = prof?.plan_expires_at ? new Date(prof.plan_expires_at as string) : null;
  const grantUntil = existing && existing > periodEnd ? existing : periodEnd;

  const { error: profErr } = await supabase()
    .from("users_profile")
    .update({ plan: "pro", plan_expires_at: grantUntil.toISOString() })
    .eq("id", sub.user_id);
  if (profErr) throw new HttpError(500, `plan flip failed: ${profErr.message}`);
  logger.info({ userId: sub.user_id, subId: sub.id, until: grantUntil.toISOString() }, "billing: activated Pro");
}

/** Renewal: extend the period from its current end and push Pro expiry out. */
async function renew(sub: SubRow, now: Date): Promise<void> {
  const plan = sub.plan_code ? await planByCode(sub.plan_code).catch(() => null) : null;
  const { data } = await supabase().from("subscriptions").select("current_period_end").eq("id", sub.id).maybeSingle();
  const base = data?.current_period_end ? new Date(data.current_period_end as string) : now;
  const from = base > now ? base : now;
  const periodEnd = addInterval(from, plan?.interval ?? "month", plan?.interval_count ?? 1);
  await supabase().from("subscriptions").update({ status: "active", current_period_end: periodEnd.toISOString() }).eq("id", sub.id);
  await supabase().from("users_profile").update({ plan: "pro", plan_expires_at: periodEnd.toISOString() }).eq("id", sub.user_id);
  logger.info({ userId: sub.user_id, subId: sub.id, until: periodEnd.toISOString() }, "billing: renewed Pro");
}

/** Cancellation: stop future renewals, keep access until period end (lazy downgrade). */
async function cancel(sub: SubRow, now: Date): Promise<void> {
  await supabase()
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: now.toISOString() })
    .eq("id", sub.id);
  logger.info({ userId: sub.user_id, subId: sub.id }, "billing: subscription cancelled (access until period end)");
}

/** Failed payment on an initial order: mark the subscription failed; no plan change. */
async function fail(sub: SubRow): Promise<void> {
  if (sub.status === "active") return; // a later failure event can't unwind a paid sub
  await supabase().from("subscriptions").update({ status: "failed" }).eq("id", sub.id);
  logger.info({ userId: sub.user_id, subId: sub.id }, "billing: payment failed");
}

export interface WebhookResult {
  handled: boolean;
  duplicate: boolean;
  event: string;
}

/**
 * Process a verified webhook. Signature verification happens at the route (it
 * needs the raw bytes); this receives the parsed event + its id and does the
 * idempotent state transition.
 */
export async function processWebhookEvent(eventId: string, evt: RazorpayEvent): Promise<WebhookResult> {
  // Idempotency: claim the event id. A replay hits the unique index (23505) and
  // returns duplicate=true without re-running any side effect.
  const sub = await resolveSubscription(evt);
  const { error: insErr } = await supabase().from("billing_events").insert({
    razorpay_event_id: eventId,
    event_type: evt.event,
    subscription_id: sub?.id ?? null,
    payload: evt as unknown as Record<string, unknown>,
  });
  if (insErr) {
    if (insErr.code === "23505") return { handled: false, duplicate: true, event: evt.event };
    throw new HttpError(500, `billing event record failed: ${insErr.message}`);
  }

  const now = new Date();
  if (!sub) {
    // Nothing to transition (e.g. an event for an order we don't know) — recorded, no-op.
    logger.warn({ event: evt.event }, "billing: webhook event with no resolvable subscription");
    return { handled: false, duplicate: false, event: evt.event };
  }

  // The idempotency row was written BEFORE the state transition. If the
  // transition now throws, roll that row back so Razorpay's automatic retry can
  // re-process the event — otherwise the retry would hit the unique index, be
  // treated as a duplicate, no-op, and the paid user would never be activated.
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
        await cancel(sub, now);
        break;
      default:
        logger.info({ event: evt.event }, "billing: unhandled webhook event (recorded)");
        return { handled: false, duplicate: false, event: evt.event };
    }
  } catch (err) {
    await supabase().from("billing_events").delete().eq("razorpay_event_id", eventId);
    throw err;
  }
  return { handled: true, duplicate: false, event: evt.event };
}
