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
import { HttpError } from "../lib/http-error.js";

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

export interface ClaimTrialResult {
  granted: boolean;
  /** Why nothing was granted (for logging/telemetry; the client just refetches). */
  reason?: "already_used" | "still_anonymous";
}

/**
 * Grant the 7-day Pro trial at the moment a GUEST converts to a real account.
 *
 * Why this exists: handle_new_user() (0104) grants the trial only on a real
 * sign-up INSERT. Converting an anonymous user (auth.updateUser email/password,
 * or linkIdentity OAuth) is an UPDATE to the SAME auth.users row — is_anonymous
 * flips to false but the AFTER INSERT trigger never re-fires — so the trial must
 * be granted here instead, keeping the invariant "trial only at real signup".
 *
 * Authoritative + idempotent:
 *   - Re-reads the user from the Auth admin API (not the possibly-stale client
 *     JWT) to confirm they are genuinely no longer anonymous before granting.
 *   - `has_used_trial` is the replay guard: a fresh real signup already has it
 *     true (never re-granted), and a second call after conversion no-ops. The
 *     UPDATE is scoped `.eq("has_used_trial", false)` so it can only ever flip a
 *     never-trialed profile, never extend an existing/lapsed one.
 */
export async function claimTrial(userId: string, ip: string | null): Promise<ClaimTrialResult> {
  const { data, error } = await supabase().auth.admin.getUserById(userId);
  if (error || !data.user) throw new HttpError(500, `trial claim: user lookup failed: ${error?.message ?? "no user"}`);
  if (data.user.is_anonymous === true) {
    // Still a guest — nothing to claim. Not an error (the client may call this
    // optimistically); just report it.
    return { granted: false, reason: "still_anonymous" };
  }

  const TRIAL_DAYS = 7;
  const expiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: updated, error: uErr } = await supabase()
    .from("users_profile")
    .update({ plan: "pro", plan_expires_at: expiresAt, has_used_trial: true })
    .eq("id", userId)
    .eq("has_used_trial", false)
    .select("id")
    .maybeSingle();
  if (uErr) throw new HttpError(500, `trial claim failed: ${uErr.message}`);
  if (!updated) return { granted: false, reason: "already_used" };

  await recordTrialStart(userId, ip); // coarse abuse signal, best-effort
  logger.info({ userId }, "granted 7-day trial on guest->real conversion");
  return { granted: true };
}
