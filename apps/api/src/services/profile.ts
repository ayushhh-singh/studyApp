import type { BilingualText, OnboardingBody, Profile, ProfileUpdateBody } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, conflict, notFound } from "../lib/http-error.js";
import { istToday, daysBetween } from "../lib/ist.js";
import { normalizeTourState } from "./tour.js";

interface ExamInfo {
  days_to_exam: number | null;
  next_exam_label_i18n: { hi: string; en: string } | null;
}

/**
 * `profileSchema` embeds `tourStateSchema`, so a raw jsonb `tour_state` with
 * legacy sections_seen keys (a coachmark renamed/retired since — see
 * normalizeTourState's own comment) would otherwise make `profileResponseSchema.parse`
 * throw on every GET/PATCH /profile — the endpoint RequireAuth, onboarding,
 * and the welcome-moment redirect all gate the entire authenticated app on.
 */
function toProfile(row: unknown, examInfo: ExamInfo): Profile {
  const r = row as Record<string, unknown>;
  return { ...(r as unknown as Profile), ...examInfo, tour_state: normalizeTourState(r.tour_state) };
}

const PROFILE_COLUMNS =
  "id, display_name, handle, preferred_locale, target_exam_year, medium, plan, streak_count, last_active_date, " +
  "streak_freezes, streak_freeze_used_on, onboarding_completed, study_hours_per_day, show_on_mains_board, tour_state";

/**
 * Days until the next scheduled Prelims (from exam_calendar), same lookup
 * pattern as dashboard.ts's getGreeting — null if nothing is scheduled.
 */
async function getNextExamInfo(): Promise<ExamInfo> {
  const today = istToday();
  const { data, error } = await supabase()
    .from("exam_calendar")
    .select("title_i18n, exam_date")
    .eq("exam_stage", "prelims")
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `exam calendar lookup failed: ${error.message}`);
  if (!data) return { days_to_exam: null, next_exam_label_i18n: null };
  return {
    days_to_exam: daysBetween(today, data.exam_date as string),
    next_exam_label_i18n: data.title_i18n as BilingualText,
  };
}

export async function getProfile(userId: string): Promise<Profile> {
  const [{ data, error }, examInfo] = await Promise.all([
    supabase().from("users_profile").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
    getNextExamInfo(),
  ]);
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  if (!data) throw notFound("Profile not found");
  return toProfile(data, examInfo);
}

export async function updateProfile(userId: string, patch: ProfileUpdateBody): Promise<Profile> {
  const [{ data, error }, examInfo] = await Promise.all([
    supabase().from("users_profile").update(patch).eq("id", userId).select(PROFILE_COLUMNS).single(),
    getNextExamInfo(),
  ]);
  if (error) throw new HttpError(500, `profile update failed: ${error.message}`);
  return toProfile(data, examInfo);
}

/**
 * Complete the onboarding wizard: write the collected fields and flip
 * onboarding_completed so RequireAuth stops redirecting here. A taken handle
 * surfaces as a 409 (unique violation, Postgres 23505) so the wizard can ask
 * for another.
 */
export async function completeOnboarding(userId: string, body: OnboardingBody): Promise<Profile> {
  const [{ data, error }, examInfo] = await Promise.all([
    supabase()
      .from("users_profile")
      .update({
        display_name: body.display_name,
        handle: body.handle ?? null,
        medium: body.medium,
        preferred_locale: body.preferred_locale,
        target_exam_year: body.target_exam_year,
        study_hours_per_day: body.study_hours_per_day,
        onboarding_completed: true,
      })
      .eq("id", userId)
      .select(PROFILE_COLUMNS)
      .single(),
    getNextExamInfo(),
  ]);
  if (error) {
    if (error.code === "23505") throw conflict("That handle is already taken");
    throw new HttpError(500, `onboarding failed: ${error.message}`);
  }
  return toProfile(data, examInfo);
}

/**
 * GET /profile/export — a raw data-portability dump (attempts + their answers,
 * answer submissions + their evaluations). Not a typed/shared-schema response;
 * this is a one-off download, not a UI-consumed endpoint.
 */
export async function exportUserData(
  userId: string,
): Promise<{ attempts: unknown[]; submissions: unknown[] }> {
  const [attemptsRes, submissionsRes] = await Promise.all([
    supabase()
      .from("attempts")
      .select("*, attempt_answers(*)")
      .eq("user_id", userId)
      .order("started_at", { ascending: false }),
    supabase()
      .from("answer_submissions")
      .select("*, evaluations(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);
  if (attemptsRes.error) throw new HttpError(500, `export attempts query failed: ${attemptsRes.error.message}`);
  if (submissionsRes.error)
    throw new HttpError(500, `export submissions query failed: ${submissionsRes.error.message}`);
  return { attempts: attemptsRes.data ?? [], submissions: submissionsRes.data ?? [] };
}
