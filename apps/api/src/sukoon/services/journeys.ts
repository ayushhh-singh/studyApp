/**
 * Sukoon F7 — Guided Journeys (user-facing runtime). Content itself is
 * static, admin-authored + published (see services/journeys-admin.ts and
 * SUKOON_CONTEXT: "nothing generates content at runtime that can be
 * pre-generated") — this service only reads published journeys, resolves the
 * per-user tier lock (same pattern as services/exercises.ts), computes
 * day-locking, and reads/writes per-user progress. Every query is owner-scoped
 * by user_id (defense in depth alongside RLS 0079/0053 — the real guard since
 * the API uses the service-role client).
 *
 * DAY-LOCKING (blueprint F7: "daily step unlock"): a day D unlocks at IST
 * midnight of (journey start date + D-1 calendar days) — a pure function of
 * `started_at`, never a stored "unlock time" column, so it can't drift out of
 * sync with the calendar. A single-day journey (days=1) is exempt from
 * day-locking BY CONSTRUCTION: min(1, elapsed+1) is always 1, so the
 * Exam-Eve Panic journey (blueprint #1) is always fully open the moment it's
 * started — there is never a "next day" for it to lock behind.
 */
import {
  type SukoonJourney,
  type SukoonJourneyCompleteStepBody,
  type SukoonJourneyDaySummary,
  type SukoonJourneyProgress,
  type SukoonJourneyState,
  type SukoonJourneyStep,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../../lib/http-error.js";
import { istDateString, istToday, daysBetween, shiftDate, istClockUtc } from "../../lib/ist.js";
import { getSukoonTier } from "./entitlements.js";
import { recordSukoonEvent } from "./analytics.js";
import {
  getJourneyRowBySlug,
  listStepsForJourney,
  toStep,
  JOURNEY_COLUMNS,
  type JourneyRow,
  type StepRow,
} from "../lib/journey-store.js";

const PROGRESS_COLUMNS =
  "id, journey_id, current_day, completed_steps, started_at, completed_at, reflection, reflection_at, step_responses";

interface ProgressRow {
  id: string;
  journey_id: string;
  current_day: number;
  completed_steps: string[] | null;
  started_at: string;
  completed_at: string | null;
  reflection: string | null;
  reflection_at: string | null;
  step_responses: Record<string, unknown> | null;
}

/** Day D unlocks at IST midnight of (start + D-1 days); `days=1` collapses to
 *  always-1 (see header — this IS the exam-eve exemption, not a special case).
 *  Exported for services/reminders.ts (F11 journey-step reminder), which needs
 *  the SAME day-lock math without duplicating it. */
export function calcUnlockedDay(startedAtIso: string, totalDays: number): number {
  const startDate = istDateString(Date.parse(startedAtIso));
  const elapsed = daysBetween(startDate, istToday());
  return Math.min(totalDays, Math.max(1, elapsed + 1));
}

/** The UTC instant the day AFTER `unlockedDay` opens (only meaningful when
 *  unlockedDay < totalDays — the day_locked state). */
function nextUnlockAt(startedAtIso: string, unlockedDay: number): string {
  const startDate = istDateString(Date.parse(startedAtIso));
  return istClockUtc(shiftDate(startDate, unlockedDay), 0, 0);
}

/** Used ONLY where a NEW grant of access is being decided (starting or
 *  retaking a journey) — unpublished must always block a fresh start. */
async function getPublishedJourneyOrThrow(slug: string) {
  const row = await getJourneyRowBySlug(slug);
  if (!row || !row.published) throw notFound("Journey not found");
  return row;
}

/**
 * Used by every READ/continue path (detail, today, complete-step, reflection):
 * a journey is accessible if it's published, OR the caller already has a
 * progress row on it. This matters because `unpublish` is meant to pull a
 * journey out of NEW discovery/starts — not retroactively 404 someone
 * mid-journey the moment an admin unpublishes it to fix a typo. A user with
 * no progress on an unpublished journey still gets a clean 404 (never expose
 * draft content to someone who hasn't legitimately started it).
 */
async function getAccessibleJourneyOrThrow(
  userId: string,
  slug: string,
): Promise<{ journey: JourneyRow; progressRow: ProgressRow | null }> {
  const journey = await getJourneyRowBySlug(slug);
  if (!journey) throw notFound("Journey not found");
  const progressRow = await getProgressRow(userId, journey.id);
  if (!journey.published && !progressRow) throw notFound("Journey not found");
  return { journey, progressRow };
}

async function getProgressRow(userId: string, journeyId: string): Promise<ProgressRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_journey_progress")
    .select(PROGRESS_COLUMNS)
    .eq("user_id", userId)
    .eq("journey_id", journeyId)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon journey progress lookup failed: ${error.message}`);
  return data as unknown as ProgressRow | null;
}

function toProgress(row: ProgressRow, totalDays: number): SukoonJourneyProgress {
  return {
    journey_id: row.journey_id,
    started_at: row.started_at,
    completed_at: row.completed_at,
    current_unlocked_day: calcUnlockedDay(row.started_at, totalDays),
    completed_step_ids: row.completed_steps ?? [],
    reflection: row.reflection,
    reflection_at: row.reflection_at,
  };
}

/** GET /journeys — the catalog. `locked` mirrors services/exercises.ts's
 *  tier-resolution pattern exactly. */
export async function listJourneys(userId: string): Promise<SukoonJourney[]> {
  const [{ data: journeyData, error: jErr }, tier] = await Promise.all([
    supabase()
      .from("sukoon_journeys")
      .select(JOURNEY_COLUMNS)
      .eq("published", true)
      .order("days", { ascending: true })
      .order("title_en", { ascending: true }),
    getSukoonTier(userId),
  ]);
  if (jErr) throw new HttpError(500, `sukoon journeys list failed: ${jErr.message}`);
  const journeys = (journeyData as unknown as JourneyRow[]) ?? [];
  if (journeys.length === 0) return [];

  const ids = journeys.map((j) => j.id);
  const [{ data: stepData, error: sErr }, { data: progressData, error: pErr }] = await Promise.all([
    supabase().from("sukoon_journey_steps").select("journey_id").in("journey_id", ids),
    supabase().from("sukoon_journey_progress").select(PROGRESS_COLUMNS).eq("user_id", userId).in("journey_id", ids),
  ]);
  if (sErr) throw new HttpError(500, `sukoon journeys step-count failed: ${sErr.message}`);
  if (pErr) throw new HttpError(500, `sukoon journeys progress failed: ${pErr.message}`);

  const stepCounts = new Map<string, number>();
  for (const r of (stepData as { journey_id: string }[] | null) ?? []) {
    stepCounts.set(r.journey_id, (stepCounts.get(r.journey_id) ?? 0) + 1);
  }
  const progressByJourney = new Map<string, ProgressRow>(
    ((progressData as ProgressRow[] | null) ?? []).map((r) => [r.journey_id, r]),
  );

  return journeys.map((j) => ({
    id: j.id,
    slug: j.slug,
    title_hi: j.title_hi,
    title_en: j.title_en,
    description_hi: j.description_hi,
    description_en: j.description_en,
    days: j.days,
    total_steps: stepCounts.get(j.id) ?? 0,
    premium: j.premium,
    locked: j.premium && tier === "free",
    version: j.version,
    progress: progressByJourney.has(j.id) ? toProgress(progressByJourney.get(j.id)!, j.days) : null,
  }));
}

/** GET /journeys/:slug */
export async function getJourneyDetail(
  userId: string,
  slug: string,
): Promise<{ journey: SukoonJourney; days_summary: SukoonJourneyDaySummary[] }> {
  const { journey: row, progressRow: existingProgress } = await getAccessibleJourneyOrThrow(userId, slug);
  const [steps, tier] = await Promise.all([listStepsForJourney(row.id), getSukoonTier(userId)]);
  const progressRow = existingProgress;

  const byDay = new Map<number, number>();
  for (const s of steps) byDay.set(s.day, (byDay.get(s.day) ?? 0) + 1);
  const days_summary: SukoonJourneyDaySummary[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, step_count]) => ({ day, step_count }));

  const journey: SukoonJourney = {
    id: row.id,
    slug: row.slug,
    title_hi: row.title_hi,
    title_en: row.title_en,
    description_hi: row.description_hi,
    description_en: row.description_en,
    days: row.days,
    total_steps: steps.length,
    premium: row.premium,
    locked: row.premium && tier === "free",
    version: row.version,
    progress: progressRow ? toProgress(progressRow, row.days) : null,
  };
  return { journey, days_summary };
}

/**
 * POST /journeys/:slug/start — idempotent while a run is in progress;
 * RESTARTS in place (blueprint: "re-take anytime") when the existing row is
 * already completed. A locked (premium, free-tier) journey 402s here rather
 * than letting a client start one it can't actually use.
 */
export async function startJourney(userId: string, slug: string): Promise<SukoonJourneyProgress> {
  const journey = await getPublishedJourneyOrThrow(slug);
  if (journey.premium) {
    const tier = await getSukoonTier(userId);
    if (tier === "free") {
      void recordSukoonEvent(userId, "cap_hit", { feature: "journey_premium", tier });
      throw new HttpError(402, "This journey needs Sukoon Plus or Pro", { feature: "sukoon_journey_premium" });
    }
  }

  const existing = await getProgressRow(userId, journey.id);
  if (existing && !existing.completed_at) {
    return toProgress(existing, journey.days); // already in progress — no-op
  }

  const fresh = {
    user_id: userId,
    journey_id: journey.id,
    current_day: 1,
    completed_steps: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    reflection: null,
    reflection_at: null,
    step_responses: {},
  };

  const { data, error } = existing
    ? await supabase()
        .from("sukoon_journey_progress")
        .update(fresh)
        .eq("id", existing.id)
        .select(PROGRESS_COLUMNS)
        .single()
    : await supabase()
        .from("sukoon_journey_progress")
        .insert(fresh)
        .select(PROGRESS_COLUMNS)
        .single();
  if (error) throw new HttpError(500, `sukoon journey start failed: ${error.message}`);
  return toProgress(data as unknown as ProgressRow, journey.days);
}

interface JourneyStateResult {
  state: SukoonJourneyState;
  progress: SukoonJourneyProgress | null;
  step: SukoonJourneyStep | null;
  next_unlock_at: string | null;
}

function computeState(steps: StepRow[], progressRow: ProgressRow, totalDays: number): JourneyStateResult {
  const progress = toProgress(progressRow, totalDays);
  if (progressRow.completed_at) {
    return { state: "completed", progress, step: null, next_unlock_at: null };
  }
  const completed = new Set(progressRow.completed_steps ?? []);
  const unlockedDay = progress.current_unlocked_day;
  const next = steps.find((s) => s.day <= unlockedDay && !completed.has(s.id));
  if (next) {
    return { state: "step", progress, step: toStep(next), next_unlock_at: null };
  }
  if (unlockedDay >= totalDays) {
    // Every step is unlocked and done, but completed_at wasn't set yet — a
    // completeStep call always sets it at exactly this point, so this branch
    // is only reachable on a raced/partial write; treat it as completed.
    return { state: "completed", progress, step: null, next_unlock_at: null };
  }
  return { state: "day_locked", progress, step: null, next_unlock_at: nextUnlockAt(progressRow.started_at, unlockedDay) };
}

/** GET /journeys/:slug/today — the day player's one read. */
export async function getTodayState(userId: string, slug: string): Promise<JourneyStateResult> {
  const { journey, progressRow } = await getAccessibleJourneyOrThrow(userId, slug);
  if (!progressRow) return { state: "not_started", progress: null, step: null, next_unlock_at: null };
  const steps = await listStepsForJourney(journey.id);
  return computeState(steps, progressRow, journey.days);
}

/**
 * POST /journeys/:slug/steps/:stepId/complete — idempotent (re-completing an
 * already-done step just re-derives the current state, no double-write).
 * Guards the day-lock server-side too (defense in depth beyond the FE, which
 * should never render a locked step's complete action in the first place).
 */
export async function completeJourneyStep(
  userId: string,
  slug: string,
  stepId: string,
  body: SukoonJourneyCompleteStepBody,
): Promise<JourneyStateResult> {
  const { journey, progressRow } = await getAccessibleJourneyOrThrow(userId, slug);
  if (!progressRow) throw badRequest("Start the journey before completing a step");
  if (progressRow.completed_at) return computeState(await listStepsForJourney(journey.id), progressRow, journey.days);

  const steps = await listStepsForJourney(journey.id);
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw notFound("Step not found");

  const unlockedDay = calcUnlockedDay(progressRow.started_at, journey.days);
  if (step.day > unlockedDay) throw badRequest("This day hasn't unlocked yet");

  const completedIds = new Set(progressRow.completed_steps ?? []);
  if (!completedIds.has(stepId)) {
    completedIds.add(stepId);
    const stepResponses = { ...(progressRow.step_responses ?? {}) };
    if (body.response !== undefined && body.response !== null) stepResponses[stepId] = body.response;

    // A per-step check, not a count comparison: if an admin re-saves this
    // journey's content mid-flight, every step gets a FRESH id (delete +
    // reinsert — see journeys-admin.ts), so a user's older completed_step_ids
    // are stale uuids that will never match the new steps. A size-based
    // `completedIds.size >= steps.length` would false-positive "done" the
    // moment stale leftover ids happened to outnumber a newly-shrunk step
    // list, without the user having done any of the actual new steps.
    const allDone = steps.every((s) => completedIds.has(s.id));
    const patch = {
      completed_steps: Array.from(completedIds),
      current_day: Math.max(progressRow.current_day, step.day),
      step_responses: stepResponses,
      completed_at: allDone ? new Date().toISOString() : null,
    };
    const { data, error } = await supabase()
      .from("sukoon_journey_progress")
      .update(patch)
      .eq("id", progressRow.id)
      .select(PROGRESS_COLUMNS)
      .single();
    if (error) throw new HttpError(500, `sukoon journey step-complete failed: ${error.message}`);
    if (allDone) {
      void recordSukoonEvent(userId, "journey_completed", { journey_slug: slug, days: journey.days });
    }
    return computeState(steps, data as unknown as ProgressRow, journey.days);
  }
  return computeState(steps, progressRow, journey.days);
}

/** POST /journeys/:slug/reflection — only once the journey is fully done
 *  (blueprint: "completion reflection save"). */
export async function saveJourneyReflection(
  userId: string,
  slug: string,
  reflection: string,
): Promise<SukoonJourneyProgress> {
  const { journey, progressRow } = await getAccessibleJourneyOrThrow(userId, slug);
  if (!progressRow || !progressRow.completed_at) {
    throw badRequest("Finish the journey before saving a reflection");
  }
  const { data, error } = await supabase()
    .from("sukoon_journey_progress")
    .update({ reflection, reflection_at: new Date().toISOString() })
    .eq("id", progressRow.id)
    .select(PROGRESS_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `sukoon journey reflection save failed: ${error.message}`);
  return toProgress(data as unknown as ProgressRow, journey.days);
}

/**
 * F11 journey-step reminder helper: true if the user has at least one
 * IN-PROGRESS journey (started, not completed) whose day-unlocked step for
 * TODAY hasn't been completed yet. Deliberately journey-agnostic of publish
 * state (mirrors getAccessibleJourneyOrThrow's "already has progress" rule)
 * — an admin unpublishing a journey mid-flight must not silently stop its
 * reminder for someone already on it. Embeds the journey's own `days` via a
 * single joined query rather than a per-row lookup-by-id (journey-store.ts
 * only exposes lookup-by-slug, which this doesn't have).
 */
export async function hasIncompleteStepToday(userId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("sukoon_journey_progress")
    .select("journey_id, completed_steps, started_at, sukoon_journeys(days)")
    .eq("user_id", userId)
    .is("completed_at", null);
  if (error) throw new HttpError(500, `sukoon journey reminder lookup failed: ${error.message}`);

  interface Row {
    journey_id: string;
    completed_steps: string[] | null;
    started_at: string;
    sukoon_journeys: { days: number } | { days: number }[] | null;
  }
  const rows = (data as unknown as Row[]) ?? [];

  for (const row of rows) {
    const journeyMeta = Array.isArray(row.sukoon_journeys) ? row.sukoon_journeys[0] : row.sukoon_journeys;
    if (!journeyMeta) continue;
    const unlockedDay = calcUnlockedDay(row.started_at, journeyMeta.days);
    const steps = await listStepsForJourney(row.journey_id);
    const completed = new Set(row.completed_steps ?? []);
    if (steps.some((s) => s.day <= unlockedDay && !completed.has(s.id))) return true;
  }
  return false;
}
