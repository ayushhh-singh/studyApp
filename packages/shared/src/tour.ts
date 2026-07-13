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
 * The sections a <FirstVisitCoachmark> can fire in, once each, ever. Now
 * scoped to genuine SUB-features within a tab (the guided tab tour below
 * owns tab-level "what is this" orientation): a chapter's Study vs Quick
 * Revision tabs, the mentor's teach-mode toggle, "Share for peer review" on
 * an evaluation, and the magazine (which the guided tour doesn't visit, so
 * it keeps its own first-arrival orientation).
 */
export const tourSectionKeySchema = z.enum(["chapter_study_tabs", "mentor_teach_mode", "peer_review_share", "magazine"]);
export type TourSectionKey = z.infer<typeof tourSectionKeySchema>;
export const TOUR_SECTION_KEYS = tourSectionKeySchema.options;

/**
 * The guided tab tour's 9 stops, in navigation order — checked against the
 * real lib/nav.ts item ids. Dashboard is the launch point (where the
 * welcome binary choice lives), not a stop itself.
 */
export const guidedTourStopKeySchema = z.enum([
  "learn",
  "practice",
  "answers",
  "revision",
  "doubts",
  "current_affairs",
  "scoreboard",
  "community",
  "explore",
]);
export type GuidedTourStopKey = z.infer<typeof guidedTourStopKeySchema>;
export const GUIDED_TOUR_STOPS = guidedTourStopKeySchema.options;

export const welcomeTourChoiceSchema = z.enum(["tour", "skip"]);
export type WelcomeTourChoice = z.infer<typeof welcomeTourChoiceSchema>;

export const guidedTourStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export type GuidedTourStatus = z.infer<typeof guidedTourStatusSchema>;

export const guidedTourStateSchema = z.object({
  /** The welcome moment's explicit binary choice — persisted once, never re-asked. */
  choice: welcomeTourChoiceSchema.nullable().default(null),
  status: guidedTourStatusSchema.default("not_started"),
  /** Index into GUIDED_TOUR_STOPS of the stop currently shown / next to resume at. */
  step_index: z.number().int().min(0).default(0),
});
export type GuidedTourState = z.infer<typeof guidedTourStateSchema>;

export const tourStateSchema = z.object({
  welcome_seen: z.boolean().default(false),
  checklist_stage: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  sections_seen: z.record(tourSectionKeySchema, z.boolean()).default({}),
  /** One-tap dismiss of the Dashboard checklist card ("bring it back" in Settings). */
  dismissed: z.boolean().default(false),
  guided_tour: guidedTourStateSchema.default({ choice: null, status: "not_started", step_index: 0 }),
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
    /**
     * (Re)start the guided tab tour ("tour") or record the welcome moment's
     * "skip, I'll explore myself" choice ("skip"). "tour" always resets
     * guided_tour to {status: in_progress, step_index: 0} regardless of any
     * prior progress — used at the welcome choice screen AND by /explore's
     * Take-the-tour / Retake-the-tour buttons.
     */
    guided_tour_choice: welcomeTourChoiceSchema.optional(),
    /**
     * Advance one stop (or, from the last stop, finish). No-ops unless the
     * tour is currently in_progress.
     */
    guided_tour_advance: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type TourUpdateBody = z.infer<typeof tourUpdateBodySchema>;
