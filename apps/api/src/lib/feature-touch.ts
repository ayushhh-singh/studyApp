/**
 * feature_first_touch — one row per (user, feature_key), stamped once at the
 * REAL moment a feature is actually used (never at coachmark-dismiss). Backs
 * the /explore page's "not tried yet" badges, the Dashboard checklist's
 * stage-2 items with no other natural completion signal (scoreboard/
 * community/magazine — viewing IS the action), and feature-discovery:report.
 *
 * Fire-and-forget by design: a touch failing must never break the request
 * that triggered it (a quiz submit, a doubt sent, a page load).
 */
import type { FeatureKey } from "@neev/shared";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { currentUserId } from "./user-context.js";

export async function touchFeature(userId: string, feature: FeatureKey): Promise<void> {
  try {
    const { error } = await supabase()
      .from("feature_first_touch")
      .insert({ user_id: userId, feature_key: feature });
    // 23505 = unique violation — already touched, exactly the idempotent no-op we want.
    if (error && error.code !== "23505") {
      logger.warn({ err: error, userId, feature }, "feature-touch insert failed");
    }
  } catch (err) {
    logger.warn({ err, userId, feature }, "feature-touch insert threw");
  }
}

/** Express middleware: touch a feature on every request the router sees (view-only pages with no other natural signal). */
export function touchFeatureOnRequest(feature: FeatureKey) {
  return (_req: unknown, _res: unknown, next: () => void) => {
    void touchFeature(currentUserId(), feature);
    next();
  };
}
