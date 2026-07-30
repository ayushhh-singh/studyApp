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

/**
 * The streak family that lives on users_profile for the CURRENTLY ACTIVE exam
 * and gets parked in / restored from user_exam_streaks (0111) on a
 * target_exam switch. Kept as one named group everywhere it's threaded so the
 * four fields can never drift apart (e.g. a freeze restored without its date).
 */
interface StreakSnapshot {
  streak_count: number;
  last_active_date: string | null;
  streak_freezes: number;
  streak_freeze_used_on: string | null;
}

const DEFAULT_STREAK_SNAPSHOT: StreakSnapshot = {
  streak_count: 0,
  last_active_date: null,
  streak_freezes: 0,
  streak_freeze_used_on: null,
};

/**
 * Swaps a user's per-exam streak state on a target_exam change: the OUTGOING
 * exam's live values (still sitting on users_profile at call time — the
 * caller reads them before this runs) are parked in user_exam_streaks, and the
 * INCOMING exam's parked values are returned — or fresh defaults, if that exam
 * has never been active for this user before. The caller writes the returned
 * snapshot back onto users_profile in the SAME update that changes
 * target_exam, so a client never observes a half-applied state (old exam, but
 * still the old exam's streak numbers, or vice versa).
 */
async function swapExamStreak(
  userId: string,
  fromExam: string,
  toExam: string,
  outgoing: StreakSnapshot,
): Promise<StreakSnapshot> {
  const { error: upsertError } = await supabase()
    .from("user_exam_streaks")
    .upsert(
      { user_id: userId, exam_code: fromExam, ...outgoing },
      { onConflict: "user_id,exam_code" },
    );
  if (upsertError) throw new HttpError(500, `streak snapshot save failed: ${upsertError.message}`);

  const { data, error } = await supabase()
    .from("user_exam_streaks")
    .select("streak_count, last_active_date, streak_freezes, streak_freeze_used_on")
    .eq("user_id", userId)
    .eq("exam_code", toExam)
    .maybeSingle();
  if (error) throw new HttpError(500, `streak snapshot lookup failed: ${error.message}`);
  return (data as StreakSnapshot | null) ?? DEFAULT_STREAK_SNAPSHOT;
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

  // A target_exam change needs the CURRENT row's exam + streak values before
  // it can decide whether a swap is even needed — that read can't be folded
  // into the parallel fetchUpcomingExams below, since the outcome changes what
  // gets written.
  //
  // CONCURRENCY (2026-07-30, U3 audit): the read-park-restore-write sequence
  // above is NOT one atomic statement — it's a SELECT, then (inside
  // swapExamStreak) an UPSERT + a SELECT, then this function's own final
  // UPDATE. Two near-simultaneous PATCH /profile {target_exam} requests for
  // the SAME user (a double-click, two tabs) can both read the SAME "current"
  // row before either writes. The dangerous case isn't two requests racing to
  // the SAME destination exam (both compute byte-identical writes — harmless,
  // just redundant); it's two requests racing to DIFFERENT destinations: both
  // park the same outgoing exam's values (idempotent, fine), but the request
  // that commits its final UPDATE last wins the users_profile row — silently
  // overwriting whatever the FIRST request had just restored for ITS
  // destination exam, with no trace that exam was ever live, and no chance
  // for a THEN-current streak-count for it (e.g. a concurrent
  // daily/streak.ts refreshStreak landing in that same split second) to ever
  // get parked before being clobbered.
  //
  // `swapFromExam` set below turns that into an optimistic-concurrency guard:
  // the final UPDATE only applies `if target_exam is STILL what this request
  // observed it to be`. A losing request's UPDATE then matches 0 rows instead
  // of silently clobbering — handled after the Promise.all below. This closes
  // the "two different destinations" data-loss case entirely. It does NOT
  // close every possible race against a same-exam concurrent streak writer
  // (e.g. refreshStreak advancing streak_count for the exam a user is NOT
  // switching away from mid-request) — that residual is bounded to losing
  // streak *precision* (at most one day's advance) for one non-active exam,
  // self-corrects the next time that exam sees real activity, and would need
  // a DB-level transaction/row lock to close fully — out of proportion for a
  // low-frequency personal-settings action. A full transactional rewrite was
  // considered and rejected for that reason; this guard is the "least
  // invasive correct fix" the identified real race actually needs.
  let writePatch: ProfileUpdateBody | (ProfileUpdateBody & StreakSnapshot) = patch;
  let swapFromExam: string | null = null;
  if (patch.target_exam) {
    const { data: currentRow, error: currentError } = await supabase()
      .from("users_profile")
      .select("target_exam, streak_count, last_active_date, streak_freezes, streak_freeze_used_on")
      .eq("id", userId)
      .maybeSingle();
    if (currentError) throw new HttpError(500, `profile lookup failed: ${currentError.message}`);
    const current = currentRow as (StreakSnapshot & { target_exam: string }) | null;
    if (current && current.target_exam !== patch.target_exam) {
      swapFromExam = current.target_exam;
      const incoming = await swapExamStreak(userId, current.target_exam, patch.target_exam, {
        streak_count: current.streak_count,
        last_active_date: current.last_active_date,
        streak_freezes: current.streak_freezes,
        streak_freeze_used_on: current.streak_freeze_used_on,
      });
      writePatch = { ...patch, ...incoming };
    }
  }

  let updateQuery = supabase().from("users_profile").update(writePatch).eq("id", userId);
  // Only guard the write when a swap actually happened — an unrelated field
  // update (display name, locale, ...) has no race to protect against here.
  if (swapFromExam) updateQuery = updateQuery.eq("target_exam", swapFromExam);

  const [{ data, error }, examRows] = await Promise.all([
    updateQuery.select(PROFILE_COLUMNS).maybeSingle(),
    fetchUpcomingExams(today),
  ]);
  if (error) throw new HttpError(500, `profile update failed: ${error.message}`);
  if (!data) {
    if (!swapFromExam) {
      // No guard was added, so 0 rows matched only because the profile row
      // itself is gone — e.g. a pruned/deleted account whose JWT is still
      // held by the browser. Same case getProfile treats as an orphaned
      // session (401, not a generic 500), so the client's existing
      // 401→signOut path handles it the same way here.
      throw new HttpError(401, "Session no longer valid — please sign in again.");
    }
    // The guard's WHERE clause matched 0 rows: another request already moved
    // target_exam away from what this one observed. If it landed on the SAME
    // exam this request itself wanted, that's a harmless race (e.g. a
    // double-click) — return the winner's row instead of erroring, so the
    // "loser" of the race still sees success. Otherwise it's a genuine
    // conflicting switch and the client should retry against the fresh state.
    const { data: winner, error: winnerError } = await supabase()
      .from("users_profile")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (winnerError) throw new HttpError(500, `profile lookup failed: ${winnerError.message}`);
    if (winner && (winner as { target_exam?: string }).target_exam === patch.target_exam) {
      return toProfile(winner, examInfoFor(examRows, examCodeOf(winner), today));
    }
    throw conflict("Your exam selection was just changed in another session — please retry.");
  }
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
  // target_exam is optional here (unlike updateProfile's PATCH path) — the
  // wizard usually doesn't ask, and a fresh profile row is always still on the
  // DB default (uppsc, see 0106), so there is no prior exam's streak to park
  // and no swap to perform. If a caller ever DOES send one, guard it the same
  // way updateProfile does before persisting.
  if (body.target_exam) await assertSelectableExam(body.target_exam);
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
        ...(body.target_exam ? { target_exam: body.target_exam } : {}),
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
