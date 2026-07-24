/**
 * Sukoon entitlements — the ONE place that reads a user's Sukoon tier and the
 * daily chat cap it grants (blueprint F2/§4). Deliberately self-contained (reads
 * sukoon_subscriptions, NOT Neev's users_profile/plans) so the module stays
 * standalone-extractable per CLAUDE.md's isolation rule. Sukoon billing
 * (Session 10) isn't wired yet, so sukoon_subscriptions is empty today and every
 * user resolves to `free` — the caps still enforce correctly.
 */
import type { SukoonReflectionUsage, SukoonTier } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { istToday } from "../../lib/ist.js";

/** Daily chat-message caps per tier (blueprint F2). Code constants, not data. */
export const SUKOON_CHAT_CAPS: Record<SukoonTier, number> = {
  free: 15,
  plus: 100,
  pro: 200,
};

/**
 * AI reflection allowance (blueprint F4). free is a LIFETIME budget of 3 tries
 * (a taste of the feature); plus/pro get a generous DAILY budget (reflections
 * are cheap Haiku calls, so this is fair-use, not a paywall). Code constants.
 */
export const SUKOON_FREE_REFLECTION_LIFETIME = 3;
export const SUKOON_REFLECTION_DAILY_CAPS: Record<Exclude<SukoonTier, "free">, number> = {
  plus: 10,
  pro: 30,
};

/** A tier row counts if the subscription is currently usable. */
const ACTIVE_STATUSES = ["active", "trialing"] as const;

/**
 * The user's effective Sukoon tier. Reads the most recent usable
 * sukoon_subscriptions row; defaults to `free` on no row or any error (a lookup
 * failure must never grant more than free, and must never fail the chat).
 */
export async function getSukoonTier(userId: string): Promise<SukoonTier> {
  const { data, error } = await supabase()
    .from("sukoon_subscriptions")
    .select("tier, status, current_period_end")
    .eq("user_id", userId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon tier lookup failed; defaulting to free");
    return "free";
  }
  if (!data) return "free";

  // A period end in the past means the row hasn't been reconciled yet — treat as free.
  const end = (data as { current_period_end: string | null }).current_period_end;
  if (end && new Date(end) <= new Date()) return "free";

  const tier = (data as { tier: SukoonTier }).tier;
  return tier === "plus" || tier === "pro" ? tier : "free";
}

export interface ChatUsage {
  tier: SukoonTier;
  used: number;
  limit: number;
  remaining: number;
}

/** Today's (IST-day) chat usage + the tier cap. Read-only — see consumeChatMessage. */
export async function getChatUsage(userId: string): Promise<ChatUsage> {
  const tier = await getSukoonTier(userId);
  const limit = SUKOON_CHAT_CAPS[tier];

  const { data, error } = await supabase()
    .from("sukoon_usage")
    .select("chat_msgs")
    .eq("user_id", userId)
    .eq("date", istToday())
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon usage read failed; assuming 0 used");
  }
  const used = (data as { chat_msgs: number } | null)?.chat_msgs ?? 0;
  return { tier, used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Atomically consume one chat message against today's cap. Returns `allowed:
 * false` (without incrementing) when already at the limit, so the caller can
 * emit the cap-reached state before spending any model call. On the happy path
 * it increments today's counter (upserting the row) and returns the fresh usage.
 *
 * NOTE: the read→increment is not a single SQL statement, so two concurrent
 * requests could both pass the check at exactly the boundary and push usage one
 * over the cap. That's an acceptable ±1 for a soft wellness cap (never a
 * correctness/billing gate); a hard guarantee would need a DB function.
 */
export async function consumeChatMessage(
  userId: string,
): Promise<{ allowed: boolean; usage: ChatUsage }> {
  const usage = await getChatUsage(userId);
  if (usage.used >= usage.limit) return { allowed: false, usage };

  const today = istToday();
  const next = usage.used + 1;
  const { error } = await supabase()
    .from("sukoon_usage")
    .upsert(
      { user_id: userId, date: today, chat_msgs: next },
      { onConflict: "user_id,date" },
    );
  if (error) {
    // A counter write failure shouldn't block the user's message (fail open on
    // the cap) — but log it loudly so a systemic failure is visible.
    logger.error({ err: error.message, userId }, "sukoon chat usage increment failed");
  }
  return {
    allowed: true,
    usage: { ...usage, used: next, remaining: Math.max(0, usage.limit - next) },
  };
}

// ---------------------------------------------------------------------------
// F4 — AI reflection allowance. free is metered over LIFETIME (sum of the
// reflections counter across every day); plus/pro over the current IST day.
// ---------------------------------------------------------------------------

/** Sum of all reflection uses ever (free's lifetime budget denominator). */
async function lifetimeReflectionCount(userId: string): Promise<number> {
  const { data, error } = await supabase()
    .from("sukoon_usage")
    .select("reflections")
    .eq("user_id", userId);
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon lifetime reflection read failed; assuming 0");
    return 0;
  }
  return (data as { reflections: number }[] | null)?.reduce((n, r) => n + (r.reflections ?? 0), 0) ?? 0;
}

/** Today's (IST-day) reflection count (plus/pro's daily budget numerator). */
async function todayReflectionCount(userId: string): Promise<number> {
  const { data, error } = await supabase()
    .from("sukoon_usage")
    .select("reflections")
    .eq("user_id", userId)
    .eq("date", istToday())
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon today reflection read failed; assuming 0");
  }
  return (data as { reflections: number } | null)?.reflections ?? 0;
}

/** The reflection allowance meter (read-only — see consumeReflection). */
export async function getReflectionUsage(userId: string): Promise<SukoonReflectionUsage> {
  const tier = await getSukoonTier(userId);
  if (tier === "free") {
    const used = await lifetimeReflectionCount(userId);
    const limit = SUKOON_FREE_REFLECTION_LIFETIME;
    return { tier, scope: "lifetime", used, limit, remaining: Math.max(0, limit - used) };
  }
  const used = await todayReflectionCount(userId);
  const limit = SUKOON_REFLECTION_DAILY_CAPS[tier];
  return { tier, scope: "daily", used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Consume one reflection against the tier's budget. Returns `allowed:false`
 * (without incrementing) when the budget is spent, so the caller emits the
 * gated state before any model call. Increments today's `reflections` counter
 * (upsert preserves the day's chat_msgs). Fails OPEN on a counter-write error
 * (a wellness feature must never hard-fail on telemetry) — same posture as chat.
 */
export async function consumeReflection(
  userId: string,
): Promise<{ allowed: boolean; usage: SukoonReflectionUsage }> {
  const usage = await getReflectionUsage(userId);
  if (usage.used >= usage.limit) return { allowed: false, usage };

  const today = istToday();
  const todayCount = await todayReflectionCount(userId);
  const { error } = await supabase()
    .from("sukoon_usage")
    .upsert(
      { user_id: userId, date: today, reflections: todayCount + 1 },
      { onConflict: "user_id,date" },
    );
  if (error) {
    logger.error({ err: error.message, userId }, "sukoon reflection usage increment failed");
  }
  const used = usage.used + 1;
  return { allowed: true, usage: { ...usage, used, remaining: Math.max(0, usage.limit - used) } };
}
