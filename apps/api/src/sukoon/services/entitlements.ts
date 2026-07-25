/**
 * Sukoon entitlements — the ONE place that reads a user's Sukoon tier and the
 * daily chat cap it grants (blueprint F2/§4). Deliberately self-contained (reads
 * sukoon_subscriptions, NOT Neev's users_profile/plans) so the module stays
 * standalone-extractable per CLAUDE.md's isolation rule. Sukoon billing
 * (Session 10) isn't wired yet, so sukoon_subscriptions is empty today and every
 * user resolves to `free` — the caps still enforce correctly.
 */
import {
  SUKOON_FREE_MEDITATION_LIFETIME,
  SUKOON_MEDITATION_DAILY_CAPS,
  SUKOON_VOICE_MONTHLY_CAP_SECONDS,
  SUKOON_VOICE_WARNING_SECONDS,
  type SukoonEntitlements,
  type SukoonFeatureFlags,
  type SukoonMeditationUsage,
  type SukoonReflectionUsage,
  type SukoonTier,
  type SukoonTierSource,
  type SukoonVoiceUsage,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { istToday } from "../../lib/ist.js";
import { hasActivePaidNeevPlan } from "../lib/neev-bridge.js";

/** The headline Neev-bundle discount (blueprint §4) — the copy number shown in
 *  the UI. The amount ACTUALLY applied at order time is each plan's own
 *  bundle_discount_pct column (data), so this is only the marketing headline. */
export const SUKOON_BUNDLE_DISCOUNT_PCT = 40;

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

/**
 * A tier row counts if the subscription is currently usable. `cancelled` is
 * INCLUDED: a cancelled-but-in-period subscription keeps its tier until the
 * period ends (end-of-period access — F13/blueprint; mirrors Neev, where a
 * cancelled paid user keeps Pro until plan_expires_at). The period-end check in
 * loadSukoonSubContext then drops it to free once it lapses.
 */
const ACTIVE_STATUSES = ["active", "trialing", "cancelled"] as const;

/** The effective Sukoon subscription context — tier + where it comes from. */
interface SukoonSubContext {
  tier: SukoonTier;
  source: SukoonTierSource;
  currentPeriodEnd: string | null;
}

const FREE_CONTEXT: SukoonSubContext = { tier: "free", source: "free", currentPeriodEnd: null };

/** Tier rank for "best of what the user currently holds" (pro > plus > free). */
function tierRank(tier: string): number {
  return tier === "pro" ? 2 : tier === "plus" ? 1 : 0;
}

/**
 * The user's effective Sukoon subscription context: the BEST currently-valid
 * (active/trialing/cancelled AND period not lapsed) sukoon_subscriptions row —
 * highest tier, then the one whose access lasts longest — resolved to a tier +
 * its SOURCE (paid vs the 7-day trial). Defaults to `free` on no usable row or
 * any error — a lookup failure must never grant more than free, and must never
 * fail the chat. This is the ONE place the tier is resolved (getSukoonTier and
 * getSukoonEntitlements both delegate here).
 *
 * NOTE: it fetches ALL currently-valid rows and picks the best in memory, rather
 * than "newest row, lazy-expire it". The stateless lazy downgrade is the
 * `current_period_end > now` filter itself (Sukoon has no persisted plan flag to
 * flip, unlike Neev's users_profile.plan). Fetching all rows is what makes a
 * newer-but-SHORTER purchase (e.g. a monthly bought while a yearly is still
 * running, then the monthly expires first) never hide the older-but-still-valid
 * subscription and wrongly drop a paying user to free.
 */
async function loadSukoonSubContext(userId: string): Promise<SukoonSubContext> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase()
    .from("sukoon_subscriptions")
    .select("tier, is_trial, current_period_end")
    .eq("user_id", userId)
    .in("status", ACTIVE_STATUSES)
    // Currently-valid only. PostgREST .gt excludes NULLs, but every
    // active/trialing/cancelled row always has current_period_end set
    // (activate()/startSukoonTrial()/renew() all set it), so nothing valid is
    // dropped — a NULL here would be a data anomaly we correctly ignore.
    .gt("current_period_end", nowIso);

  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon tier lookup failed; defaulting to free");
    return FREE_CONTEXT;
  }
  const rows = (data ?? []) as { tier: SukoonTier; is_trial: boolean; current_period_end: string | null }[];

  let best: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (tierRank(r.tier) === 0) continue; // a 'free'-tier row shouldn't exist; ignore it
    if (
      !best ||
      tierRank(r.tier) > tierRank(best.tier) ||
      (tierRank(r.tier) === tierRank(best.tier) &&
        new Date(r.current_period_end ?? 0) > new Date(best.current_period_end ?? 0))
    ) {
      best = r;
    }
  }
  if (!best) return FREE_CONTEXT;

  const tier = best.tier === "plus" || best.tier === "pro" ? best.tier : "free";
  if (tier === "free") return FREE_CONTEXT;
  return { tier, source: best.is_trial ? "trial" : "paid", currentPeriodEnd: best.current_period_end };
}

/**
 * The user's effective Sukoon tier. Defaults to `free` on no usable row or any
 * error. Consumed by chat caps, reflections, journeys/exercise premium locks,
 * insights and (future) voice.
 */
export async function getSukoonTier(userId: string): Promise<SukoonTier> {
  return (await loadSukoonSubContext(userId)).tier;
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

// ---------------------------------------------------------------------------
// Personalized guided meditations (extends F6). GENERATING one is a real LLM +
// one-time TTS render, so it's metered exactly like F4 reflections: free gets a
// small LIFETIME taste, plus/pro a generous DAILY budget. A REPLAY of an already
// generated meditation (cached script + audio) is free and never metered here —
// only the service's generate path calls consumeMeditation, and only on a real
// cache MISS. Uses the sukoon_usage.meditations counter (0098).
// ---------------------------------------------------------------------------

/** Sum of all meditation generations ever (free's lifetime budget denominator). */
async function lifetimeMeditationCount(userId: string): Promise<number> {
  const { data, error } = await supabase()
    .from("sukoon_usage")
    .select("meditations")
    .eq("user_id", userId);
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon lifetime meditation read failed; assuming 0");
    return 0;
  }
  return (data as { meditations: number }[] | null)?.reduce((n, r) => n + (r.meditations ?? 0), 0) ?? 0;
}

/** Today's (IST-day) meditation generation count (plus/pro's daily numerator). */
async function todayMeditationCount(userId: string): Promise<number> {
  const { data, error } = await supabase()
    .from("sukoon_usage")
    .select("meditations")
    .eq("user_id", userId)
    .eq("date", istToday())
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon today meditation read failed; assuming 0");
  }
  return (data as { meditations: number } | null)?.meditations ?? 0;
}

/** The meditation allowance meter (read-only — see consumeMeditation). */
export async function getMeditationUsage(userId: string): Promise<SukoonMeditationUsage> {
  const tier = await getSukoonTier(userId);
  if (tier === "free") {
    const used = await lifetimeMeditationCount(userId);
    const limit = SUKOON_FREE_MEDITATION_LIFETIME;
    return { tier, scope: "lifetime", used, limit, remaining: Math.max(0, limit - used) };
  }
  const used = await todayMeditationCount(userId);
  const limit = SUKOON_MEDITATION_DAILY_CAPS[tier];
  return { tier, scope: "daily", used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Consume one meditation generation against the tier's budget. Returns
 * `allowed:false` (without incrementing) when the budget is spent, so the
 * caller emits the gated 402 before any model/TTS spend. Increments today's
 * `meditations` counter (upsert preserves the day's other counters). Fails OPEN
 * on a counter-write error, same posture as chat/reflection above.
 */
export async function consumeMeditation(
  userId: string,
): Promise<{ allowed: boolean; usage: SukoonMeditationUsage }> {
  const usage = await getMeditationUsage(userId);
  if (usage.used >= usage.limit) return { allowed: false, usage };

  const today = istToday();
  const todayCount = await todayMeditationCount(userId);
  const { error } = await supabase()
    .from("sukoon_usage")
    .upsert(
      { user_id: userId, date: today, meditations: todayCount + 1 },
      { onConflict: "user_id,date" },
    );
  if (error) {
    logger.error({ err: error.message, userId }, "sukoon meditation usage increment failed");
  }
  const used = usage.used + 1;
  return { allowed: true, usage: { ...usage, used, remaining: Math.max(0, usage.limit - used) } };
}

// ---------------------------------------------------------------------------
// F10 — Voice Mode (Sukoon Pro only). Metered in whole seconds against
// sukoon_voice_usage, keyed by calendar month ('YYYY-MM', IST) — a single
// counter for the whole month rather than a daily one, since the blueprint's
// cap is monthly (60 min/mo), not daily.
// ---------------------------------------------------------------------------

/** The current IST calendar month, 'YYYY-MM' (matches sukoon_voice_usage.month). */
function currentVoiceMonth(): string {
  return istToday().slice(0, 7);
}

/**
 * The voice-minutes meter (read-only — see consumeVoiceSeconds). Works for
 * EVERY tier: `eligible` is the field callers gate on (free/plus always read
 * `eligible:false` with a full, untouched budget — there's nothing to meter
 * for a tier that can't use the feature at all).
 */
export async function getVoiceUsage(userId: string): Promise<SukoonVoiceUsage> {
  const tier = await getSukoonTier(userId);
  const eligible = tier === "pro";

  const { data, error } = await supabase()
    .from("sukoon_voice_usage")
    .select("seconds_used")
    .eq("user_id", userId)
    .eq("month", currentVoiceMonth())
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon voice usage read failed; assuming 0 used");
  }
  const used = (data as { seconds_used: number } | null)?.seconds_used ?? 0;
  const limit = SUKOON_VOICE_MONTHLY_CAP_SECONDS;
  return {
    tier,
    eligible,
    used_seconds: used,
    limit_seconds: limit,
    remaining_seconds: Math.max(0, limit - used),
    warning: eligible && used >= SUKOON_VOICE_WARNING_SECONDS,
  };
}

/**
 * Adds `seconds` (a completed turn's actual STT+TTS duration) to this month's
 * counter and returns the fresh meter. Called ONCE per turn, AFTER the reply
 * has already been generated and spoken — a turn that's already happened must
 * never be un-happened by a counter-write failure, so this fails OPEN (logs,
 * still returns a best-guess usage) exactly like consumeChatMessage/
 * consumeReflection above. The pre-turn gate (remaining_seconds <= 0) is the
 * caller's job (services/voice.ts), same "check before, add after" split as
 * the chat/reflection caps — the ±(one turn's seconds) overshoot this permits
 * under concurrency is an acceptable soft-cap tolerance, not a billing gate.
 */
export async function consumeVoiceSeconds(userId: string, seconds: number): Promise<SukoonVoiceUsage> {
  const before = await getVoiceUsage(userId);
  const added = Math.max(0, Math.round(seconds));
  const next = before.used_seconds + added;

  const { error } = await supabase()
    .from("sukoon_voice_usage")
    .upsert(
      { user_id: userId, month: currentVoiceMonth(), seconds_used: next },
      { onConflict: "user_id,month" },
    );
  if (error) {
    logger.error({ err: error.message, userId }, "sukoon voice usage increment failed");
  }
  const limit = SUKOON_VOICE_MONTHLY_CAP_SECONDS;
  return {
    ...before,
    used_seconds: next,
    remaining_seconds: Math.max(0, limit - next),
    warning: before.eligible && next >= SUKOON_VOICE_WARNING_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// F13 — unified entitlements snapshot (tier + trial + bundle + caps + features).
// This is the ONE object the Sukoon UI reads for its plan row, paywall copy, and
// every premium gate. getSukoonTier stays the cheap read used on the hot chat
// path; this richer snapshot is for /billing/entitlements and /billing/subscription.
// ---------------------------------------------------------------------------

/**
 * Whether the user has EVER started a Sukoon trial (one trial per user, per the
 * "separate Sukoon trial" decision). Reads for any is_trial row regardless of
 * status/expiry so a lapsed trial still counts. Fails CLOSED (true = "already
 * used") — a lookup failure must never hand out a second trial.
 */
export async function hasUsedSukoonTrial(userId: string): Promise<boolean> {
  const { count, error } = await supabase()
    .from("sukoon_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_trial", true);
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon trial-usage check failed; treating as used");
    return true;
  }
  return (count ?? 0) > 0;
}

/** Premium feature gates resolved from the effective tier (blueprint §4). */
export function sukoonFeatureFlags(tier: SukoonTier): SukoonFeatureFlags {
  const plus = tier === "plus" || tier === "pro";
  const pro = tier === "pro";
  return {
    ai_reflections: plus,
    all_journeys: plus,
    weekly_insights: plus,
    meditation_library: plus,
    voice_note_journal: plus,
    voice_mode: pro,
    deep_insights: pro,
    priority_conversations: pro,
  };
}

/**
 * The full Sukoon entitlements snapshot. Runs the tier/context read, the two
 * usage meters, the trial-usage check, and the Neev-bundle eligibility check
 * concurrently. Never throws for a billing-state reason — the worst case is a
 * free snapshot (fail-safe, matching every meter here).
 */
export async function getSukoonEntitlements(userId: string): Promise<SukoonEntitlements> {
  const [ctx, chat, reflections, usedTrial, bundleEligible] = await Promise.all([
    loadSukoonSubContext(userId),
    getChatUsage(userId),
    getReflectionUsage(userId),
    hasUsedSukoonTrial(userId),
    hasActivePaidNeevPlan(userId),
  ]);
  return {
    tier: ctx.tier,
    tier_source: ctx.source,
    is_on_trial: ctx.source === "trial",
    current_period_end: ctx.currentPeriodEnd,
    trial_eligible: !usedTrial,
    bundle_eligible: bundleEligible,
    bundle_discount_pct: SUKOON_BUNDLE_DISCOUNT_PCT,
    chat,
    reflections,
    features: sukoonFeatureFlags(ctx.tier),
  };
}
