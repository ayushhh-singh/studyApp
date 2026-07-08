import { supabase } from "./supabase.js";

/**
 * All onboarded user ids. Background jobs (nightly schedulers, `pnpm *:build`
 * CLIs) used to run for the single DEV_USER_ID; post-auth they iterate every
 * real user instead. Only onboarded profiles are included — a half-signed-up
 * account with no data yet has nothing to recompute.
 */
export async function listAllUserIds(): Promise<string[]> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("id")
    .eq("onboarding_completed", true);
  if (error) throw new Error(`listAllUserIds failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}
