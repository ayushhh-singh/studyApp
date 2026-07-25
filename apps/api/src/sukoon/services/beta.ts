/**
 * Session 14 — SUKOON_BETA_COHORT gating (blueprint §7 Session 14: "enable for
 * a 300-user Neev cohort"). Purely a UI-visibility gate (which users see the
 * Wellness nav item / homepage card) — it never blocks API access, since a
 * user who already knows the /sukoon URL during the beta is not a security
 * concern the way an un-entitled feature would be.
 *
 * A user counts as in_cohort when EITHER:
 *   - sukoonConfig.betaCohortGating is off (ops has opened the beta to
 *     everyone — see config.ts), or
 *   - they have a sukoon_beta_cohort row, or
 *   - they're a Neev admin (reuses lib/admin.ts's isCurrentUserAdmin, the same
 *     shared gate routes/admin.ts already reuses — always see it for testing).
 */
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { isCurrentUserAdmin } from "../../lib/admin.js";
import { sukoonConfig } from "../config.js";

async function isInBetaCohortTable(userId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("sukoon_beta_cohort")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // A lookup failure must never grant more than "not in cohort" — fail closed.
    logger.warn({ err: error.message, userId }, "sukoon beta cohort lookup failed; defaulting to not-in-cohort");
    return false;
  }
  return !!data;
}

export interface SukoonBetaStatusResult {
  gating_enabled: boolean;
  in_cohort: boolean;
}

export async function getSukoonBetaStatus(userId: string): Promise<SukoonBetaStatusResult> {
  if (!sukoonConfig.betaCohortGating) {
    return { gating_enabled: false, in_cohort: true };
  }
  const [inTable, isAdmin] = await Promise.all([isInBetaCohortTable(userId), isCurrentUserAdmin()]);
  return { gating_enabled: true, in_cohort: inTable || isAdmin };
}
