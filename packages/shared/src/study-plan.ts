import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * AI Study Plan — a weekly checkable schedule generated from the learner's
 * profile, exam date, and stated hours/day. Persisted in `study_plans`
 * (schema pre-existed from Session 2's scaffolding; this is the first
 * feature layer to read/write it). Regeneration is capped at 1x/IST-day.
 */

export const planTaskKindSchema = z.enum(["read", "practice", "revise", "write", "mock"]);
export type PlanTaskKind = z.infer<typeof planTaskKindSchema>;

export const planTaskSchema = z.object({
  id: z.string(),
  title_i18n: bilingualTextSchema,
  kind: planTaskKindSchema,
  duration_min: z.number().int(),
  done: z.boolean(),
  node_id: z.string().uuid().nullable().optional(),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

export const planDaySchema = z.object({
  date: z.string(),
  day_label_i18n: bilingualTextSchema,
  focus_i18n: bilingualTextSchema,
  tasks: z.array(planTaskSchema),
});
export type PlanDay = z.infer<typeof planDaySchema>;

export const studyPlanSchema = z.object({
  id: z.string().uuid(),
  target_date: z.string().nullable(),
  generated_by_model: z.string().nullable(),
  hours_per_day: z.number().nullable(),
  days: z.array(planDaySchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type StudyPlan = z.infer<typeof studyPlanSchema>;

export const activePlanSchema = z.object({
  plan: studyPlanSchema.nullable(),
  can_regenerate_today: z.boolean(),
});
export type ActivePlanState = z.infer<typeof activePlanSchema>;

export const activePlanResponseSchema = apiEnvelopeSchema(activePlanSchema);
export type ActivePlanResponse = z.infer<typeof activePlanResponseSchema>;

export const generatePlanBodySchema = z.object({
  hours_per_day: z.number().min(0.5).max(16),
});
export type GeneratePlanBody = z.infer<typeof generatePlanBodySchema>;

export const toggleTaskBodySchema = z.object({
  date: z.string(),
  task_id: z.string(),
  done: z.boolean(),
});
export type ToggleTaskBody = z.infer<typeof toggleTaskBodySchema>;

export const studyPlanResponseSchema = apiEnvelopeSchema(studyPlanSchema);
export type StudyPlanResponse = z.infer<typeof studyPlanResponseSchema>;

// SSE events for POST /stream/study-plan/generate
export const planStatusEventSchema = z.object({ stage: z.string() });
export const planDoneEventSchema = z.object({ plan: studyPlanSchema });
export const planErrorEventSchema = z.object({ message: z.string() });

/** Minimal shape threaded into the dashboard "Today" card. */
export const todayPlanTaskSchema = z.object({
  id: z.string(),
  title_i18n: bilingualTextSchema,
  kind: planTaskKindSchema,
  done: z.boolean(),
});
export type TodayPlanTask = z.infer<typeof todayPlanTaskSchema>;
