import type {
  SukoonOnboardingBody,
  SukoonProfile,
  SukoonProfileUpdateBody,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { SUKOON_CONSENT_VERSION } from "../consent.js";

const PROFILE_COLUMNS =
  "user_id, language, exam, exam_attempt, exam_date, restricted_mode, voice_pref, " +
  "reminder_time, mood_reminder_enabled, journey_reminder_enabled, exam_eve_reminder_enabled, " +
  "onboarding_completed, created_at, updated_at";

/**
 * The Sukoon profile, or null when the user hasn't onboarded yet — a normal,
 * expected state (not an error), which the onboarding gate reads to redirect.
 * maybeSingle() returns null with no row rather than throwing.
 */
export async function getSukoonProfile(userId: string): Promise<SukoonProfile | null> {
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon profile lookup failed: ${error.message}`);
  return (data as unknown as SukoonProfile | null) ?? null;
}

/** WHO-5 raw (Σ of five 0–5 answers, 0–25) → the standard ×4 percentage (0–100). */
function who5Percentage(answers: number[]): { raw: number; percentage: number } {
  const raw = answers.reduce((sum, a) => sum + a, 0);
  return { raw, percentage: raw * 4 };
}

/**
 * Complete Sukoon onboarding (F1): upsert the profile, append a versioned
 * consent row, and (if provided) store the optional WHO-5 baseline. The
 * consent version is the SERVER constant — the client only attests
 * (`consent_accepted: true`), it never chooses a version.
 *
 * restricted_mode is DERIVED here (`!age_confirmed_18`), never taken from the
 * client as a settable field — an under-18 account must not be able to hand us
 * restricted_mode=false and unlock open chat.
 */
export async function completeSukoonOnboarding(
  userId: string,
  body: SukoonOnboardingBody,
): Promise<SukoonProfile> {
  const db = supabase();

  const { data, error } = await db
    .from("sukoon_profiles")
    .upsert(
      {
        user_id: userId,
        language: body.language,
        exam: body.exam ?? null,
        exam_attempt: body.exam_attempt ?? null,
        exam_date: body.exam_date ?? null,
        restricted_mode: !body.age_confirmed_18,
        reminder_time: body.reminder_time ?? null,
        onboarding_completed: true,
      },
      { onConflict: "user_id" },
    )
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `sukoon onboarding failed: ${error.message}`);

  // Versioned consent — one row per (user, version). ignoreDuplicates makes a
  // re-submit of the SAME version a no-op; a future version bump mints a new row.
  const { error: consentError } = await db
    .from("sukoon_consents")
    .upsert(
      { user_id: userId, consent_version: SUKOON_CONSENT_VERSION },
      { onConflict: "user_id,consent_version", ignoreDuplicates: true },
    );
  if (consentError) throw new HttpError(500, `sukoon consent write failed: ${consentError.message}`);

  // Optional WHO-5 baseline (F8) → a wellbeing check-in, never a clinical score.
  if (body.who5) {
    const { raw, percentage } = who5Percentage(body.who5);
    const { error: checkinError } = await db.from("sukoon_checkins").insert({
      user_id: userId,
      type: "who5",
      answers_json: { answers: body.who5, raw },
      score: percentage,
    });
    if (checkinError) throw new HttpError(500, `sukoon baseline write failed: ${checkinError.message}`);
  }

  return data as unknown as SukoonProfile;
}

/** PATCH /profile — update the user-editable subset (restricted_mode excluded). */
export async function updateSukoonProfile(
  userId: string,
  patch: SukoonProfileUpdateBody,
): Promise<SukoonProfile> {
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .update(patch)
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon profile update failed: ${error.message}`);
  if (!data) throw new HttpError(404, "Sukoon profile not found — complete onboarding first");
  return data as unknown as SukoonProfile;
}
