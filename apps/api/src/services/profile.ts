import type { BilingualText, OnboardingBody, Profile, ProfileUpdateBody } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, conflict } from "../lib/http-error.js";
import { istToday, daysBetween } from "../lib/ist.js";
import { normalizeTourState } from "./tour.js";
import { upcomingExamsQuery, pickNextExam } from "../lib/exam-calendar.js";
import { assertSelectableExam } from "../lib/exams.js";
import { DEFAULT_EXAM_CODE } from "@neev/shared";

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
  "id, display_name, handle, preferred_locale, target_exam_year, target_exam, medium, plan, streak_count, last_active_date, " +
  "streak_freezes, streak_freeze_used_on, onboarding_completed, study_hours_per_day, show_on_mains_board, tour_state";

/**
 * Days until the next scheduled Prelims (from exam_calendar), same lookup
 * pattern as dashboard.ts's getGreeting — null if nothing is scheduled.
 */
/**
 * Upcoming dates for EVERY exam, fetched in parallel with the profile read so
 * the countdown never serialises behind it (0106). Narrowed to the user's own
 * exam by `examInfoFor` once the profile row is in hand.
 */
async function fetchUpcomingExams(today: string): Promise<unknown> {
  const { data, error } = await upcomingExamsQuery(today);
  if (error) throw new HttpError(500, `exam calendar lookup failed: ${error.message}`);
  return data;
}

// `today` is threaded rather than re-derived: calling istToday() once for the
// query bound and again for the day count can straddle IST midnight and yield
// an off-by-one countdown.
function examInfoFor(rows: unknown, examCode: string, today: string): ExamInfo {
  const row = pickNextExam(rows, examCode);
  if (!row) return { days_to_exam: null, next_exam_label_i18n: null };
  return {
    days_to_exam: daysBetween(today, row.exam_date),
    next_exam_label_i18n: row.title_i18n as BilingualText,
  };
}

/** The user's own exam, defaulting defensively for a row written before 0106. */
function examCodeOf(row: unknown): string {
  return ((row as Record<string, unknown>)?.target_exam as string) || DEFAULT_EXAM_CODE;
}

export async function getProfile(userId: string): Promise<Profile> {
  const today = istToday();
  const [{ data, error }, examRows] = await Promise.all([
    supabase().from("users_profile").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
    fetchUpcomingExams(today),
  ]);
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  // A valid, unexpired JWT that resolves to a user with NO profile row means the
  // session is orphaned — the account was deleted (e.g. a pruned abandoned guest,
  // or a deleted user) while the browser still holds its token. Return 401 (not
  // 404) so the client's existing 401→signOut path clears the dead session and
  // the app self-heals into a fresh one, instead of looping on profile errors.
  if (!data) throw new HttpError(401, "Session no longer valid — please sign in again.");
  return toProfile(data, examInfoFor(examRows, examCodeOf(data), today));
}

export async function updateProfile(userId: string, patch: ProfileUpdateBody): Promise<Profile> {
  const today = istToday();
  // The FK on target_exam only proves the exam EXISTS. A non-live exam has no
  // syllabus, questions or chapters, so switching to one would strand the user
  // in an empty app — reject it as a 400 rather than persist it.
  if (patch.target_exam) await assertSelectableExam(patch.target_exam);
  const [{ data, error }, examRows] = await Promise.all([
    supabase().from("users_profile").update(patch).eq("id", userId).select(PROFILE_COLUMNS).single(),
    fetchUpcomingExams(today),
  ]);
  if (error) throw new HttpError(500, `profile update failed: ${error.message}`);
  return toProfile(data, examInfoFor(examRows, examCodeOf(data), today));
}

/**
 * Complete the onboarding wizard: write the collected fields and flip
 * onboarding_completed so RequireAuth stops redirecting here. A taken handle
 * surfaces as a 409 (unique violation, Postgres 23505) so the wizard can ask
 * for another.
 */
export async function completeOnboarding(userId: string, body: OnboardingBody): Promise<Profile> {
  const today = istToday();
  const [{ data, error }, examRows] = await Promise.all([
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
    fetchUpcomingExams(today),
  ]);
  if (error) {
    if (error.code === "23505") throw conflict("That handle is already taken");
    throw new HttpError(500, `onboarding failed: ${error.message}`);
  }
  return toProfile(data, examInfoFor(examRows, examCodeOf(data), today));
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
