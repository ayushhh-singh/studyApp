import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examStageSchema } from "./types";
import { testSummarySchema } from "./tests";

export const dashboardNextExamSchema = z
  .object({
    exam_stage: examStageSchema,
    title_i18n: bilingualTextSchema,
    exam_date: z.string(),
    days_until: z.number().int(),
    is_tentative: z.boolean(),
  })
  .nullable();
export type DashboardNextExam = z.infer<typeof dashboardNextExamSchema>;

export const dashboardGreetingSchema = z.object({
  display_name: z.string().nullable(),
  streak_count: z.number().int(),
  /** This load just advanced the streak — the flame should animate. */
  streak_incremented_today: z.boolean(),
  /** Today already counts toward the streak. */
  streak_active_today: z.boolean(),
  next_exam: dashboardNextExamSchema,
});
export type DashboardGreeting = z.infer<typeof dashboardGreetingSchema>;

export const dashboardContinueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attempt"),
    attempt_id: z.string().uuid(),
    test_title_i18n: bilingualTextSchema.nullable(),
    answered_count: z.number().int(),
    total_count: z.number().int(),
    last_activity_at: z.string(),
  }),
  z.object({
    type: z.literal("syllabus_node"),
    syllabus_node_id: z.string().uuid(),
    paper_code: z.string(),
    title_i18n: bilingualTextSchema,
    last_activity_at: z.string(),
  }),
  z.object({ type: z.literal("none") }),
]);
export type DashboardContinue = z.infer<typeof dashboardContinueSchema>;

/** One row of the guided "Today" checklist. */
export const dashboardChecklistItemSchema = z.object({
  key: z.enum(["daily_quiz", "answer_set", "revision", "continue_reading"]),
  done: z.boolean(),
  current: z.number().int(),
  target: z.number().int(),
});
export type DashboardChecklistItem = z.infer<typeof dashboardChecklistItemSchema>;

export const dashboardTodaySchema = z.object({
  srs_due_count: z.number().int(),
  current_affairs_today_count: z.number().int(),
  daily_quiz: testSummarySchema.nullable(),
  /** The guided-mode checklist + its progress ring numbers. */
  checklist: z.array(dashboardChecklistItemSchema),
  checklist_completed: z.number().int(),
  checklist_total: z.number().int(),
});
export type DashboardToday = z.infer<typeof dashboardTodaySchema>;

export const dashboardRecentScoreSchema = z.object({
  attempt_id: z.string().uuid(),
  submitted_at: z.string(),
  score_pct: z.number(),
});

export const dashboardPaperAccuracySchema = z.object({
  paper_code: z.string(),
  accuracy_pct: z.number(),
  answered_count: z.number().int(),
});

export const dashboardPerformanceSchema = z.object({
  recent_scores: z.array(dashboardRecentScoreSchema),
  accuracy_by_paper: z.array(dashboardPaperAccuracySchema),
});
export type DashboardPerformance = z.infer<typeof dashboardPerformanceSchema>;

export const dashboardWeaknessNodeSchema = z.object({
  syllabus_node_id: z.string().uuid(),
  paper_code: z.string(),
  title_i18n: bilingualTextSchema,
  accuracy_pct: z.number(),
  answered_count: z.number().int(),
});
export type DashboardWeaknessNode = z.infer<typeof dashboardWeaknessNodeSchema>;

export const dashboardAnswerSpotlightSchema = z.object({
  latest: z
    .object({
      submission_id: z.string().uuid(),
      overall_score: z.number().nullable(),
      max_score: z.number().nullable(),
      created_at: z.string(),
      question_stem_i18n: bilingualTextSchema.nullable(),
    })
    .nullable(),
});
export type DashboardAnswerSpotlight = z.infer<typeof dashboardAnswerSpotlightSchema>;

export const dashboardSummarySchema = z.object({
  greeting: dashboardGreetingSchema,
  continue: dashboardContinueSchema,
  today: dashboardTodaySchema,
  performance: dashboardPerformanceSchema,
  weakness_radar: z.array(dashboardWeaknessNodeSchema),
  answer_spotlight: dashboardAnswerSpotlightSchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const dashboardSummaryResponseSchema = apiEnvelopeSchema(dashboardSummarySchema);
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
