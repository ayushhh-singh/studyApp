/**
 * Trial abuse SIGNAL (not enforcement). Every new user gets a 7-day Pro trial
 * (granted in handle_new_user, migration 0075). This records a coarse, salted
 * hash of the sign-up IP — one row per user — so `pnpm trial-abuse:report` can
 * surface accounts clustering on the same hash for a human to look at.
 *
 * Deliberately NOT an auto-blocker: at this scale a false positive (a shared
 * hostel/college/CGNAT IP legitimately hosting many real aspirants) is worse
 * than the abuse it would catch. Nothing here restricts a user.
 *
 * A raw IP is never stored — only sha256(salt:ip) truncated. Best-effort: a
 * failure here must never break the user's onboarding.
 */
import { createHash } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

/** Coarse salted hash of a client IP. `TRIAL_IP_SALT` (env) pepper; falls back to a fixed value in dev. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.TRIAL_IP_SALT ?? "neev-trial-v1";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 20);
}

/**
 * Record a user's trial start, keyed by IP hash. Idempotent (PK on user_id +
 * ignoreDuplicates) so the FIRST sign-up IP is kept and a re-call never
 * overwrites it. Fire-and-forget from the caller — swallows errors.
 */
export async function recordTrialStart(userId: string, ip: string | null): Promise<void> {
  const { error } = await supabase()
    .from("trial_starts")
    .upsert({ user_id: userId, ip_hash: hashIp(ip) }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) logger.warn({ err: error, userId }, "trial-start log failed");
}
