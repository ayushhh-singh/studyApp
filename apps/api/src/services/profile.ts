import type { Profile, ProfileUpdateBody } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

const PROFILE_COLUMNS =
  "id, display_name, preferred_locale, target_exam_year, medium, plan, streak_count, last_active_date";

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  if (!data) throw notFound("Profile not found");
  return data as unknown as Profile;
}

export async function updateProfile(userId: string, patch: ProfileUpdateBody): Promise<Profile> {
  const { data, error } = await supabase()
    .from("users_profile")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `profile update failed: ${error.message}`);
  return data as unknown as Profile;
}
