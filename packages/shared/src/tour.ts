import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * The 12 pillars this app wants a new user to discover — shared by the
 * two-stage Dashboard checklist (a subset), the /explore page (all 12), and
 * feature_first_touch (the one table both read from).
 */
export const featureKeySchema = z.enum([
  "daily_quiz",
  "study_chapter",
  "answer_evaluation",
  "mentor_chat",
  "mentor_teach_mode",
  "revision_srs",
  "mock",
  "time_attack",
  "community",
  "scoreboard",
  "current_affairs",
  "magazine",
]);
export type FeatureKey = z.infer<typeof featureKeySchema>;
export const FEATURE_KEYS = featureKeySchema.options;

/**
 * The sections a <FirstVisitCoachmark> can fire in, once each, ever. Nine, not
 * eight — current_affairs (the exam-lens filter tabs) is a real coachmark
 * anchor and a real feature_first_touch/Explore pillar, so it belongs here
 * alongside the other eight even though it wasn't in the original shorthand list.
 */
export const tourSectionKeySchema = z.enum([
  "learn",
  "practice",
  "answers",
  "revision",
  "mentor",
  "community",
  "scoreboard",
  "magazine",
  "current_affairs",
]);
export type TourSectionKey = z.infer<typeof tourSectionKeySchema>;

export const tourStateSchema = z.object({
  welcome_seen: z.boolean().default(false),
  checklist_stage: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  sections_seen: z.record(tourSectionKeySchema, z.boolean()).default({}),
  /** One-tap dismiss of the Dashboard checklist card ("bring it back" in Settings). */
  dismissed: z.boolean().default(false),
});
export type TourState = z.infer<typeof tourStateSchema>;

/** A checklist task may map to more than one feature key (mock OR time attack). */
export const tourChecklistItemKeySchema = z.enum([
  "daily_quiz",
  "study_chapter",
  "mentor_chat",
  "answer_evaluation",
  "revision_srs",
  "mock_or_time_attack",
  "scoreboard",
  "community",
  "magazine",
]);
export type TourChecklistItemKey = z.infer<typeof tourChecklistItemKeySchema>;

export const tourChecklistItemSchema = z.object({
  key: tourChecklistItemKeySchema,
  done: z.boolean(),
});
export type TourChecklistItem = z.infer<typeof tourChecklistItemSchema>;

export const tourChecklistStageSchema = z.object({
  items: z.array(tourChecklistItemSchema),
  completed: z.number().int(),
  total: z.number().int(),
});
export type TourChecklistStage = z.infer<typeof tourChecklistStageSchema>;

export const tourSuggestedChapterNodeSchema = z
  .object({
    node_id: z.string().uuid(),
    paper_code: z.string(),
    title_i18n: bilingualTextSchema,
  })
  .nullable();
export type TourSuggestedChapterNode = z.infer<typeof tourSuggestedChapterNodeSchema>;

export const tourStatePayloadSchema = z.object({
  tour_state: tourStateSchema,
  stage1: tourChecklistStageSchema,
  stage2: tourChecklistStageSchema,
  /** Which stage's card to show right now — null once both are done or it's been dismissed/expired. */
  active_stage: z.union([z.literal(1), z.literal(2)]).nullable(),
  show_checklist: z.boolean(),
  feature_first_touch: z.record(featureKeySchema, z.string().nullable()),
  /** A real, high-weightage node with a published chapter — the checklist's "read one study chapter" deep link. */
  suggested_chapter_node: tourSuggestedChapterNodeSchema,
});
export type TourStatePayload = z.infer<typeof tourStatePayloadSchema>;

export const tourStateResponseSchema = apiEnvelopeSchema(tourStatePayloadSchema);
export type TourStateResponse = z.infer<typeof tourStateResponseSchema>;

export const tourUpdateBodySchema = z
  .object({
    welcome_seen: z.boolean().optional(),
    sections_seen: z.record(tourSectionKeySchema, z.boolean()).optional(),
    dismissed: z.boolean().optional(),
    /** "Replay tour" — resets tour_state to its default, wizard-fresh shape. */
    reset: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type TourUpdateBody = z.infer<typeof tourUpdateBodySchema>;
