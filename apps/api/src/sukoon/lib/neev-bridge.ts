/**
 * The SINGLE integration seam between Sukoon and Neev's billing — deliberately
 * the one and only place any Sukoon code reads a Neev table. Everything else in
 * apps/api/src/sukoon stays self-contained (sukoon_ tables + auth.users only),
 * so a standalone Sukoon extraction deletes/stubs exactly this file and nothing
 * else.
 *
 * Purpose: the blueprint bundle (§4) — an active PAID Neev plan grants 40% off
 * Sukoon Plus/Pro. That eligibility is intrinsically cross-product, so it lives
 * behind this seam rather than leaking Neev's schema into the entitlement/billing
 * services. In standalone mode there is no Neev, so it is a hard no-op (false).
 */
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { sukoonConfig } from "../config.js";

/**
 * Whether this user currently holds an active, PAID Neev subscription — the
 * signal that unlocks the Sukoon bundle discount.
 *
 * "Paid" = a Neev `subscriptions` row whose `started_at` is set (only the
 * webhook's activation/renewal sets it — never a 'created'/'failed' row, and
 * never Neev's own signup trial, which has no subscription behind it), AND still
 * within its period (`current_period_end > now`). A cancelled-but-in-period paid
 * user still qualifies (their access — and so the bundle — lasts to period end).
 *
 * Defaults to FALSE on any error or in standalone mode: the bundle is a discount,
 * so a lookup failure must never wrongly grant it, and must never break Sukoon.
 */
export async function hasActivePaidNeevPlan(userId: string): Promise<boolean> {
  if (sukoonConfig.mode === "standalone") return false;
  try {
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase()
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("started_at", "is", null)
      .in("status", ["active", "cancelled"])
      .gt("current_period_end", nowIso);
    if (error) {
      logger.warn({ err: error.message, userId }, "sukoon bundle: Neev plan check failed; treating as ineligible");
      return false;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    logger.warn({ err, userId }, "sukoon bundle: Neev plan check threw; treating as ineligible");
    return false;
  }
}

/**
 * The user's Neev display name, for prefilling Razorpay checkout — a pure
 * nicety. Behind the seam because sukoon_profiles stores no name; in standalone
 * mode there is no users_profile, so this returns null (checkout still works,
 * just without a prefilled name). Best-effort: null on any error.
 */
export async function getNeevDisplayName(userId: string): Promise<string | null> {
  if (sukoonConfig.mode === "standalone") return null;
  try {
    const { data } = await supabase()
      .from("users_profile")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    return (data?.display_name as string | null) ?? null;
  } catch {
    return null;
  }
}
