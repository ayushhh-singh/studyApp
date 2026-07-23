/**
 * AI Study Plan — a weekly, checkable schedule generated from the learner's
 * profile, next exam date, weakest syllabus sections (mastery engine), and
 * current SRS backlog. Persisted in `study_plans` (pre-existing table, this
 * is the first feature layer to read/write it) — one active row per user,
 * capped at one regeneration per IST calendar day.
 */
import type {
  ActivePlanState,
  BilingualText,
  PlanDay,
  PlanTask,
  PlanTaskKind,
  StudyPlan,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { conflict, HttpError, notFound, badRequest } from "../lib/http-error.js";
import { istDateString, istToday, shiftDate } from "../lib/ist.js";
import { MODELS, structuredJson } from "../lib/anthropic.js";
import { getMasteryMap } from "../mastery/compute.js";

const PLAN_DAYS = 7;

interface StudyPlanRow {
  id: string;
  user_id: string;
  target_date: string | null;
  plan: { hours_per_day?: number; days?: PlanDay[] } | null;
  generated_by_model: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const PLAN_COLUMNS = "id, user_id, target_date, plan, generated_by_model, is_active, created_at, updated_at";

function mapPlanRow(row: StudyPlanRow): StudyPlan {
  const planJson = row.plan ?? {};
  return {
    id: row.id,
    target_date: row.target_date,
    generated_by_model: row.generated_by_model,
    hours_per_day: planJson.hours_per_day ?? null,
    days: planJson.days ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function canRegenerateToday(updatedAt: string): boolean {
  return istDateString(Date.parse(updatedAt)) !== istToday();
}

async function fetchActivePlanRow(userId: string): Promise<StudyPlanRow | null> {
  const { data, error } = await supabase()
    .from("study_plans")
    .select(PLAN_COLUMNS)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new HttpError(500, `active study plan lookup failed: ${error.message}`);
  return (data as StudyPlanRow) ?? null;
}

export async function getActivePlan(userId: string): Promise<ActivePlanState> {
  const row = await fetchActivePlanRow(userId);
  if (!row) return { plan: null, can_regenerate_today: true };
  return { plan: mapPlanRow(row), can_regenerate_today: canRegenerateToday(row.updated_at) };
}

// ---------------------------------------------------------------------------
// Plan generation — pre-flight (planGenerate) + execute (executeGeneratePlan)
// ---------------------------------------------------------------------------
export type PlanEmit = (event: string, data: unknown) => void;

export interface GeneratePlanInput {
  userId: string;
  hoursPerDay: number;
  today: string;
  targetDate: string | null;
  displayName: string | null;
  targetExamYear: number | null;
  medium: string;
  nextExam: { title_i18n: BilingualText; exam_date: string; days_until: number } | null;
  weakSections: { title_i18n: BilingualText; pyq_count: number; mastery_level: string }[];
  srsDueCount: number;
}

async function loadWeakSections(
  userId: string,
): Promise<{ title_i18n: BilingualText; pyq_count: number; mastery_level: string }[]> {
  const map = await getMasteryMap(userId);
  const priority = map.nodes
    .filter((n) => n.depth === 1 && n.is_priority)
    .sort((a, b) => b.pyq_count - a.pyq_count)
    .slice(0, 3);
  if (priority.length >= 2) {
    return priority.map((n) => ({ title_i18n: n.title_i18n, pyq_count: n.pyq_count, mastery_level: n.mastery_level }));
  }
  // Not enough flagged-priority sections yet (e.g. a new user) — fall back to
  // the highest-weight depth-1 sections regardless of the priority flag, so a
  // brand-new account still gets a sensible "start here" plan.
  const fallback = map.nodes
    .filter((n) => n.depth === 1)
    .sort((a, b) => b.pyq_count - a.pyq_count)
    .slice(0, 3);
  return fallback.map((n) => ({ title_i18n: n.title_i18n, pyq_count: n.pyq_count, mastery_level: n.mastery_level }));
}

export async function planGenerate(userId: string, hoursPerDay: number): Promise<GeneratePlanInput> {
  const existing = await fetchActivePlanRow(userId);
  if (existing && !canRegenerateToday(existing.updated_at)) {
    throw conflict("The study plan can only be regenerated once per day. Come back tomorrow.");
  }

  const today = istToday();
  const [{ data: profile, error: profileError }, examRes, weakSections, srsDueRes] = await Promise.all([
    supabase().from("users_profile").select("display_name, target_exam_year, medium").eq("id", userId).maybeSingle(),
    supabase()
      .from("exam_calendar")
      .select("title_i18n, exam_date")
      .eq("exam_stage", "prelims")
      .gte("exam_date", today)
      .order("exam_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadWeakSections(userId),
    supabase()
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("fsrs_state->>due_at", new Date().toISOString()),
  ]);
  if (profileError) throw new HttpError(500, `profile lookup failed: ${profileError.message}`);
  if (examRes.error) throw new HttpError(500, `exam calendar lookup failed: ${examRes.error.message}`);
  if (srsDueRes.error) throw new HttpError(500, `SRS due count failed: ${srsDueRes.error.message}`);

  const examRow = examRes.data as { title_i18n: BilingualText; exam_date: string } | null;
  const nextExam = examRow
    ? {
        title_i18n: examRow.title_i18n,
        exam_date: examRow.exam_date,
        days_until: Math.round((Date.parse(`${examRow.exam_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
      }
    : null;

  return {
    userId,
    hoursPerDay,
    today,
    targetDate: examRow?.exam_date ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
    targetExamYear: (profile?.target_exam_year as number | null) ?? null,
    medium: (profile?.medium as string | undefined) ?? "en",
    nextExam,
    weakSections,
    srsDueCount: srsDueRes.count ?? 0,
  };
}

const PLAN_TASK_KINDS: readonly PlanTaskKind[] = ["read", "practice", "revise", "write", "mock"];

interface GeneratedTask {
  title_hi: string;
  title_en: string;
  kind: string;
  duration_min: number;
}
interface GeneratedDay {
  day_label_hi: string;
  day_label_en: string;
  focus_hi: string;
  focus_en: string;
  tasks: GeneratedTask[];
}

function planGenerationSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      days: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            day_label_hi: { type: "string" },
            day_label_en: { type: "string" },
            focus_hi: { type: "string" },
            focus_en: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title_hi: { type: "string" },
                  title_en: { type: "string" },
                  kind: { type: "string", enum: PLAN_TASK_KINDS },
                  duration_min: { type: "integer" },
                },
                required: ["title_hi", "title_en", "kind", "duration_min"],
              },
            },
          },
          required: ["day_label_hi", "day_label_en", "focus_hi", "focus_en", "tasks"],
        },
      },
    },
    required: ["days"],
  };
}

function buildPlanSystem(): string {
  return (
    "You are an expert UPPSC (UP PCS) exam-prep coach building a personalised 7-day study " +
    "plan. Every task title and focus line must be written in BOTH Hindi (Devanagari) and " +
    "English, fully populated in both languages — never leave one language thin or empty. " +
    "Each day should have 2-4 tasks of kind read/practice/revise/write/mock, with " +
    "duration_min a realistic whole number of minutes (typically 20-120) such that the day's " +
    "tasks sum to roughly the student's stated hours available that day. Prioritise the " +
    "learner's weakest, highest-PYQ-weight syllabus sections, work toward their next exam " +
    "date, and include at least one 'revise' task if they have SRS cards due. Vary the plan " +
    "across the week rather than repeating the same task every day. Return ONLY the requested " +
    "JSON, no markdown, no extra commentary."
  );
}

function buildPlanContent(input: GeneratePlanInput): string {
  const lines: string[] = [];
  lines.push(`Student: ${input.displayName ?? "a UPPSC aspirant"}, target exam year ${input.targetExamYear ?? "unspecified"}, preferred medium ${input.medium}.`);
  lines.push(`Hours available per day: ${input.hoursPerDay}.`);
  if (input.nextExam) {
    lines.push(
      `Next Prelims exam: ${input.nextExam.title_i18n.en || input.nextExam.title_i18n.hi} on ${input.nextExam.exam_date} (${input.nextExam.days_until} days away).`,
    );
  } else {
    lines.push("No upcoming exam date is currently scheduled.");
  }
  lines.push(`SRS cards due for revision right now: ${input.srsDueCount}.`);
  if (input.weakSections.length > 0) {
    lines.push("Weakest, highest-weight syllabus sections to prioritise:");
    for (const s of input.weakSections) {
      lines.push(`- ${s.title_i18n.en || s.title_i18n.hi} (mastery: ${s.mastery_level}, ${s.pyq_count} PYQs)`);
    }
  } else {
    lines.push("No practice history yet — build a balanced foundational plan across core GS topics.");
  }
  lines.push(`Generate exactly ${PLAN_DAYS} days, starting today (${input.today}).`);
  return lines.join("\n");
}

async function upsertActivePlan(
  userId: string,
  targetDate: string | null,
  planPayload: { hours_per_day: number; days: PlanDay[] },
  model: string,
): Promise<StudyPlanRow> {
  const existing = await fetchActivePlanRow(userId);
  if (existing) {
    const { data, error } = await supabase()
      .from("study_plans")
      .update({ target_date: targetDate, plan: planPayload, generated_by_model: model })
      .eq("id", existing.id)
      .select(PLAN_COLUMNS)
      .single();
    if (error) throw new HttpError(500, `study plan update failed: ${error.message}`);
    return data as StudyPlanRow;
  }
  const { data, error } = await supabase()
    .from("study_plans")
    .insert({
      user_id: userId,
      target_date: targetDate,
      plan: planPayload,
      generated_by_model: model,
      is_active: true,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `study plan insert failed: ${error.message}`);
  return data as StudyPlanRow;
}

export async function executeGeneratePlan(
  input: GeneratePlanInput,
  emit: PlanEmit,
  signal?: AbortSignal,
): Promise<void> {
  emit("status", { stage: "generating" });

  const generated = await structuredJson<{ days: GeneratedDay[] }>({
    model: MODELS.sonnet,
    effort: "medium",
    system: buildPlanSystem(),
    content: buildPlanContent(input),
    schema: planGenerationSchema(),
    maxTokens: 8000,
    purpose: "study_plan_generate",
    userId: input.userId,
    signal,
  });
  if (signal?.aborted) return;

  const days: PlanDay[] = generated.days.slice(0, PLAN_DAYS).map((d, dayIndex) => ({
    date: shiftDate(input.today, dayIndex),
    day_label_i18n: { hi: d.day_label_hi, en: d.day_label_en },
    focus_i18n: { hi: d.focus_hi, en: d.focus_en },
    tasks: d.tasks.map((t, taskIndex) => ({
      id: `d${dayIndex}-t${taskIndex}`,
      title_i18n: { hi: t.title_hi, en: t.title_en },
      kind: (PLAN_TASK_KINDS as readonly string[]).includes(t.kind) ? (t.kind as PlanTaskKind) : "practice",
      duration_min: Math.max(5, Math.round(t.duration_min)),
      done: false,
    })),
  }));

  emit("status", { stage: "persisting" });
  const row = await upsertActivePlan(
    input.userId,
    input.targetDate,
    { hours_per_day: input.hoursPerDay, days },
    MODELS.sonnet,
  );

  emit("done", { plan: mapPlanRow(row) });
}

// ---------------------------------------------------------------------------
// Toggle a task's done state
// ---------------------------------------------------------------------------
export async function toggleTask(userId: string, date: string, taskId: string, done: boolean): Promise<StudyPlan> {
  const row = await fetchActivePlanRow(userId);
  if (!row) throw notFound("No active study plan");

  const days = row.plan?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === date);
  if (dayIndex === -1) throw badRequest(`No plan day found for date ${date}`);
  const taskIndex = days[dayIndex].tasks.findIndex((t: PlanTask) => t.id === taskId);
  if (taskIndex === -1) throw badRequest(`No task ${taskId} found on ${date}`);

  const updatedDays = days.map((d, i) =>
    i === dayIndex ? { ...d, tasks: d.tasks.map((t, j) => (j === taskIndex ? { ...t, done } : t)) } : d,
  );

  const { data, error } = await supabase()
    .from("study_plans")
    .update({ plan: { hours_per_day: row.plan?.hours_per_day ?? null, days: updatedDays } })
    .eq("id", row.id)
    .select(PLAN_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `study plan task toggle failed: ${error.message}`);
  return mapPlanRow(data as StudyPlanRow);
}

// ---------------------------------------------------------------------------
// Delete one task, or a whole day, from the active plan — lets a learner trim
// a plan they didn't ask to regenerate (e.g. a task that doesn't apply, or a
// day they want off). Both are pure removals from the persisted JSON blob;
// neither touches `is_active`/regeneration cooldown.
// ---------------------------------------------------------------------------
export async function deleteTask(userId: string, date: string, taskId: string): Promise<void> {
  const row = await fetchActivePlanRow(userId);
  if (!row) throw notFound("No active study plan");

  const days = row.plan?.days ?? [];
  const dayIndex = days.findIndex((d) => d.date === date);
  if (dayIndex === -1) throw badRequest(`No plan day found for date ${date}`);
  if (!days[dayIndex].tasks.some((t: PlanTask) => t.id === taskId)) {
    throw badRequest(`No task ${taskId} found on ${date}`);
  }

  const updatedDays = days.map((d, i) =>
    i === dayIndex ? { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) } : d,
  );

  const { error } = await supabase()
    .from("study_plans")
    .update({ plan: { hours_per_day: row.plan?.hours_per_day ?? null, days: updatedDays } })
    .eq("id", row.id);
  if (error) throw new HttpError(500, `study plan task delete failed: ${error.message}`);
}

export async function deleteDay(userId: string, date: string): Promise<void> {
  const row = await fetchActivePlanRow(userId);
  if (!row) throw notFound("No active study plan");

  const days = row.plan?.days ?? [];
  if (!days.some((d) => d.date === date)) throw badRequest(`No plan day found for date ${date}`);

  const updatedDays = days.filter((d) => d.date !== date);
  const { error } = await supabase()
    .from("study_plans")
    .update({ plan: { hours_per_day: row.plan?.hours_per_day ?? null, days: updatedDays } })
    .eq("id", row.id);
  if (error) throw new HttpError(500, `study plan day delete failed: ${error.message}`);
}
