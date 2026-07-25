/**
 * Session 14 — privacy-aware product analytics: activation funnel (onboarding
 * steps), DAU/feature-usage actions, cap hits, paywall views/conversions, and
 * AGGREGATE-ONLY crisis-level counts. Mirrors Neev's own lightweight `events`
 * table (apps/api/src/services/events.ts) in shape, but kept in a dedicated
 * sukoon_ table per the module's self-containment rule (never write into
 * Neev's `events`).
 *
 * HARD RULE: this must never carry journal/chat/voice-transcript content.
 * `name` is a closed enum (packages/shared) and every prop VALUE is sanitized
 * here to a short primitive before it reaches the DB — so even a caller that
 * accidentally passes a whole message/reflection as a "prop" cannot leak it;
 * it gets truncated to PROP_VALUE_MAX_LEN and nothing longer ever persists.
 *
 * Every call site fires this fire-and-forget (`void recordSukoonEvent(...)`
 * or awaited but never re-thrown) — a dropped analytics row must never fail
 * the user-facing action it's attached to.
 */
import type { SukoonAnalyticsEventName } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";

const PROP_VALUE_MAX_LEN = 80;

type SanitizedProps = Record<string, string | number | boolean | null>;

function sanitizeProps(props: Record<string, unknown>): SanitizedProps {
  const out: SanitizedProps = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.slice(0, PROP_VALUE_MAX_LEN);
    }
    // Any other shape (array/object/undefined) is silently dropped — an event
    // prop is always a short primitive, never a nested structure.
  }
  return out;
}

/**
 * Record one analytics event. Never throws (and never rejects) — every call
 * site fires this as `void recordSukoonEvent(...)` with no `.catch()`, so the
 * WHOLE body is wrapped here rather than trusting each of the ~10 call sites
 * to remember one. Without this, a misconfigured `supabase()` client (the one
 * call in here that CAN throw synchronously, not just return `{error}`) would
 * turn into an unhandled promise rejection at every fire-and-forget site.
 */
export async function recordSukoonEvent(
  userId: string,
  name: SukoonAnalyticsEventName,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase()
      .from("sukoon_analytics_events")
      .insert({ user_id: userId, name, props: sanitizeProps(props) });
    if (error) {
      logger.warn({ err: error.message, name }, "sukoon analytics event write failed");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, name }, "sukoon analytics event write failed");
  }
}
