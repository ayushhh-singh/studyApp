/**
 * The 5-layer onboarding tour's server side: the two-stage Dashboard
 * checklist (detected entirely from feature_first_touch, itself stamped at
 * real usage points across the app — see lib/feature-touch.ts) and the
 * tour_state merge-patch (welcome/sections-seen/dismissed/reset).
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
} from "@prayasup/shared";
import { FEATURE_KEYS } from "@prayasup/shared";
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

async function getProfileRow(userId: string): Promise<{ tour_state: TourState; created_at: string }> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("tour_state, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  if (!data) throw notFound("Profile not found");
  return {
    tour_state: { ...DEFAULT_TOUR_STATE, ...(data.tour_state as Partial<TourState>) },
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
  }
  await writeTourState(userId, next);
  return buildPayload(userId, { tour_state: next, created_at: profileRow.created_at });
}
