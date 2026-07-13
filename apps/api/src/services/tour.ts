/**
 * The onboarding tour's server side: the two-stage checklist (detected
 * entirely from feature_first_touch, itself stamped at real usage points
 * across the app — see lib/feature-touch.ts), the guided tab tour's
 * progress (choice/status/step_index over GUIDED_TOUR_STOPS), and the
 * tour_state merge-patch (welcome/sections-seen/dismissed/reset/guided_tour_*).
 *
 * Every checklist item maps 1:1 (or, for "mock_or_time_attack", 1:2) onto a
 * feature_first_touch key, so there is exactly one source of truth for "has
 * this user ever done X" — no separate bespoke queries to keep in sync.
 */
import type {
  BilingualText,
  FeatureKey,
  TourChecklistItemKey,
  TourChecklistStage,
  TourState,
  TourStatePayload,
  TourSuggestedChapterNode,
  TourUpdateBody,
} from "@neev/shared";
import { FEATURE_KEYS, GUIDED_TOUR_STOPS, TOUR_SECTION_KEYS } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { istDateString, daysBetween } from "../lib/ist.js";
import { loadNodeWeightage } from "../lib/weightage.js";

const STAGE1_KEYS: TourChecklistItemKey[] = ["daily_quiz", "study_chapter", "mentor_chat"];
const STAGE2_KEYS: TourChecklistItemKey[] = [
  "answer_evaluation",
  "revision_srs",
  "mock_or_time_attack",
  "scoreboard",
  "community",
  "magazine",
];

/** Checklist auto-hides 14 days after signup even if never completed/dismissed. */
const CHECKLIST_MAX_AGE_DAYS = 14;

const DEFAULT_TOUR_STATE: TourState = {
  welcome_seen: false,
  checklist_stage: 0,
  sections_seen: {},
  dismissed: false,
  guided_tour: { choice: null, status: "not_started", step_index: 0 },
};

type TouchMap = Record<FeatureKey, string | null>;

async function getFeatureTouchMap(userId: string): Promise<TouchMap> {
  const { data, error } = await supabase()
    .from("feature_first_touch")
    .select("feature_key, first_touched_at")
    .eq("user_id", userId);
  if (error) throw new HttpError(500, `feature-touch lookup failed: ${error.message}`);
  const map = Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) as TouchMap;
  for (const row of data ?? []) {
    const key = row.feature_key as FeatureKey;
    if (key in map) map[key] = row.first_touched_at as string;
  }
  return map;
}

function isItemDone(key: TourChecklistItemKey, touch: TouchMap): boolean {
  if (key === "mock_or_time_attack") return !!touch.mock || !!touch.time_attack;
  return !!touch[key as FeatureKey];
}

function buildStage(keys: TourChecklistItemKey[], touch: TouchMap): TourChecklistStage {
  const items = keys.map((key) => ({ key, done: isItemDone(key, touch) }));
  return { items, completed: items.filter((i) => i.done).length, total: items.length };
}

/**
 * sections_seen keys change over time (a coachmark gets renamed or retired —
 * this session alone dropped "learn"/"practice"/"revision"/"current_affairs"/
 * "mentor"/"community"/"scoreboard" down to 4 sub-feature keys). An account
 * that dismissed one under an old key would otherwise carry that key in its
 * jsonb column forever, and `tourStateResponseSchema`'s strict per-key enum
 * would reject the WHOLE payload on every read — 500ing /tour permanently
 * for that account, not just hiding the one stale flag. Confirmed live
 * against this dev DB: a pre-existing "admin" account already had
 * `sections_seen: {learn, practice, revision, current_affairs}` from before
 * this session's key rename, which throws under the new enum unless dropped
 * here first. Read-time sanitization (not a migration) is deliberate — new
 * key sets should just keep shrinking old ones out on next read.
 */
function sanitizeSectionsSeen(raw: unknown): TourState["sections_seen"] {
  const out: TourState["sections_seen"] = {};
  if (!raw || typeof raw !== "object") return out;
  const validKeys: readonly string[] = TOUR_SECTION_KEYS;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true && validKeys.includes(key)) {
      (out as Record<string, boolean>)[key] = true;
    }
  }
  return out;
}

/**
 * The one place raw jsonb `tour_state` becomes a real, response-schema-safe
 * `TourState` — used here AND by services/profile.ts, since `profileSchema`
 * embeds `tourStateSchema` too and `GET/PATCH /profile` (the endpoint
 * RequireAuth, onboarding, and welcome ALL gate on) would 500 the entire
 * authenticated app for an affected account otherwise, not just /tour.
 */
export function normalizeTourState(raw: unknown): TourState {
  const partial = (raw ?? {}) as Partial<TourState> & { sections_seen?: unknown };
  return {
    ...DEFAULT_TOUR_STATE,
    ...partial,
    sections_seen: sanitizeSectionsSeen(partial.sections_seen),
  };
}

async function getProfileRow(userId: string): Promise<{ tour_state: TourState; created_at: string }> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("tour_state, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  if (!data) throw notFound("Profile not found");
  return {
    tour_state: normalizeTourState(data.tour_state),
    created_at: data.created_at as string,
  };
}

/** Persist a transition (stage advance, or any tour_state patch) — a plain jsonb column write. */
async function writeTourState(userId: string, next: TourState): Promise<void> {
  const { error } = await supabase().from("users_profile").update({ tour_state: next }).eq("id", userId);
  if (error) throw new HttpError(500, `tour_state update failed: ${error.message}`);
}

/** The highest-weightage node with a real, published chapter — the checklist's "read one study chapter" deep link. */
async function getSuggestedChapterNode(): Promise<TourSuggestedChapterNode> {
  const { data, error } = await supabase()
    .from("notes")
    .select("syllabus_node_id, syllabus_nodes(paper_code, title_i18n)")
    .eq("status", "published")
    .gt("chapter_version", 0);
  if (error) throw new HttpError(500, `chapter lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    syllabus_node_id: string;
    syllabus_nodes: { paper_code: string; title_i18n: BilingualText } | null;
  }[];
  if (rows.length === 0) return null;

  const weightage = await loadNodeWeightage();
  let best: { node_id: string; paper_code: string; title_i18n: BilingualText; total: number } | null = null;
  for (const r of rows) {
    if (!r.syllabus_nodes) continue;
    const total = weightage.get(r.syllabus_node_id)?.total ?? 0;
    if (!best || total > best.total) {
      best = { node_id: r.syllabus_node_id, paper_code: r.syllabus_nodes.paper_code, title_i18n: r.syllabus_nodes.title_i18n, total };
    }
  }
  if (!best) return null;
  return { node_id: best.node_id, paper_code: best.paper_code, title_i18n: best.title_i18n };
}

async function buildPayload(userId: string, profileRow: { tour_state: TourState; created_at: string }): Promise<TourStatePayload> {
  const touch = await getFeatureTouchMap(userId);
  const stage1 = buildStage(STAGE1_KEYS, touch);
  const stage2 = buildStage(STAGE2_KEYS, touch);

  let tourState = profileRow.tour_state;
  // Persist a real stage transition the moment we see it — the checklist's
  // stored checklist_stage is a cache of this computation, not its source.
  const computedStage: 0 | 1 | 2 = stage1.completed < stage1.total ? 0 : stage2.completed < stage2.total ? 1 : 2;
  if (computedStage !== tourState.checklist_stage && computedStage > tourState.checklist_stage) {
    tourState = { ...tourState, checklist_stage: computedStage };
    await writeTourState(userId, tourState);
  }

  const ageDays = daysBetween(istDateString(Date.parse(profileRow.created_at)), istDateString());
  const expired = ageDays > CHECKLIST_MAX_AGE_DAYS;
  const allDone = stage1.completed === stage1.total && stage2.completed === stage2.total;
  const activeStage: 1 | 2 | null = stage1.completed < stage1.total ? 1 : stage2.completed < stage2.total ? 2 : null;
  const showChecklist = !tourState.dismissed && !expired && !allDone && activeStage !== null;
  // Only worth the query while the task is still outstanding and the card is showing.
  const suggestedChapterNode = showChecklist && !touch.study_chapter ? await getSuggestedChapterNode() : null;

  return {
    tour_state: tourState,
    stage1,
    stage2,
    active_stage: activeStage,
    show_checklist: showChecklist,
    feature_first_touch: touch,
    suggested_chapter_node: suggestedChapterNode,
  };
}

export async function getTourState(userId: string): Promise<TourStatePayload> {
  const profileRow = await getProfileRow(userId);
  return buildPayload(userId, profileRow);
}

export async function updateTourState(userId: string, patch: TourUpdateBody): Promise<TourStatePayload> {
  const profileRow = await getProfileRow(userId);
  const next: TourState = patch.reset ? { ...DEFAULT_TOUR_STATE } : { ...profileRow.tour_state };
  if (!patch.reset) {
    if (patch.welcome_seen !== undefined) next.welcome_seen = patch.welcome_seen;
    if (patch.dismissed !== undefined) next.dismissed = patch.dismissed;
    if (patch.sections_seen) next.sections_seen = { ...next.sections_seen, ...patch.sections_seen };

    if (patch.guided_tour_choice === "tour") {
      // Always a fresh (re)start from stop 0 — covers the welcome choice,
      // /explore's "Take the tour" (never started / abandoned), and
      // "Retake the tour" (already completed) with the same one action.
      next.guided_tour = { choice: "tour", status: "in_progress", step_index: 0 };
    } else if (patch.guided_tour_choice === "skip") {
      next.guided_tour = { choice: "skip", status: "not_started", step_index: 0 };
    }

    if (patch.guided_tour_advance && next.guided_tour.status === "in_progress") {
      const lastIndex = GUIDED_TOUR_STOPS.length - 1;
      next.guided_tour =
        next.guided_tour.step_index >= lastIndex
          ? { ...next.guided_tour, status: "completed" }
          : { ...next.guided_tour, step_index: next.guided_tour.step_index + 1 };
    }
  }
  await writeTourState(userId, next);
  return buildPayload(userId, { tour_state: next, created_at: profileRow.created_at });
}
