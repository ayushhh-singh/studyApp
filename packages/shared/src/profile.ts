import { z } from "zod";
import { apiEnvelopeSchema, localeSchema } from "./types";
import { dashboardNextExamSchema } from "./dashboard";
import { tourStateSchema } from "./tour";
import { targetExamCodeSchema } from "./exams";

export const userPlanSchema = z.enum(["free", "pro"]);
export type UserPlan = z.infer<typeof userPlanSchema>;

/** A community handle: 3–20 chars, lowercase alphanumerics + underscore. */
export const handleSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/, "Use 3–20 lowercase letters, numbers, or underscores");

export const profileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  handle: z.string().nullable(),
  preferred_locale: localeSchema,
  target_exam_year: z.number().int().nullable(),
  /**
   * WHICH EXAM the user is preparing for. Note the deliberately-similar
   * neighbour above: `target_exam_year` is WHICH YEAR. They are unrelated —
   * do not conflate them in a query or a form. Added in migration 0106.
   */
  target_exam: targetExamCodeSchema,
  medium: localeSchema,
  plan: userPlanSchema,
  streak_count: z.number().int(),
  last_active_date: z.string().nullable(),
  streak_freezes: z.number().int(),
  streak_freeze_used_on: z.string().nullable(),
  onboarding_completed: z.boolean(),
  study_hours_per_day: z.number().int().nullable(),
  /**
   * The next milestone from `exam_calendar` — Prelims or Mains, whichever comes
   * first for this user's exam — or null when that exam has no seeded dates.
   *
   * ⚑ ONE OBJECT, deliberately, reusing the dashboard's own shape. This was four
   * flat fields (`days_to_exam`, `next_exam_label_i18n`, `next_exam_stage`, and
   * no tentative flag at all), which forced `profile-card.tsx` to REBUILD a
   * DashboardNextExam to render the shared chip — and a reconstruction of a
   * struct from its scattered parts is a place to get parts wrong. It did: it
   * hardcoded `exam_stage: "prelims"` (a lie the moment the calendar lookup
   * stopped being prelims-only) and `is_tentative: false` (so a provisional date
   * would show the "(tentative)" marker on the dashboard chip and silently not
   * on the profile one). Passing the object through removes the adapter, and
   * with it that whole class.
   *
   * `days_until` is the countdown; read `exam_stage` for "Prelims"/"Mains"
   * rather than looking for the word in `title_i18n`, which is hand-authored
   * per row and need not contain it.
   */
  next_exam: dashboardNextExamSchema,
  /** Opt-in only — Mains (Answer Writing) scores are personal; never forced. See Scoreboard. */
  show_on_mains_board: z.boolean(),
  /** The 5-layer onboarding tour's persisted progress — see GET/PATCH /tour for the full picture (checklist + feature-touch map). */
  tour_state: tourStateSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const profileUpdateBodySchema = z
  .object({
    display_name: z.string().min(1).max(120).optional(),
    /**
     * Your public identity on Community and the Scoreboards; with none you show
     * as "Anonymous" there. Until this existed a handle could be set ONCE, in
     * the onboarding wizard, and never changed — and since that step is
     * optional, most accounts simply had none for good.
     *
     * `.nullable()` is deliberate and is not the same as `.optional()`:
     *   - key absent  -> leave the handle alone (every other PATCH field)
     *   - key = null  -> CLEAR it and go back to appearing as Anonymous, which
     *                    is a legitimate privacy action, not an error state.
     * Reuses `handleSchema` rather than restating the pattern — a second copy
     * of the rule is how the two paths drift.
     */
    handle: handleSchema.nullable().optional(),
    preferred_locale: localeSchema.optional(),
    target_exam_year: z.number().int().min(2000).max(2100).optional(),
    target_exam: targetExamCodeSchema.optional(),
    medium: localeSchema.optional(),
    show_on_mains_board: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type ProfileUpdateBody = z.infer<typeof profileUpdateBodySchema>;

/** Onboarding wizard submission — completes the profile after first sign-in. */
export const onboardingBodySchema = z.object({
  display_name: z.string().min(1).max(120),
  handle: handleSchema.optional(),
  medium: localeSchema,
  preferred_locale: localeSchema,
  target_exam_year: z.number().int().min(2000).max(2100),
  study_hours_per_day: z.number().int().min(1).max(18),
  /**
   * WHICH EXAM the user is preparing for. Optional — an onboarding wizard that
   * doesn't yet ask this (or a caller upgrading from an older client) leaves
   * the column at its DB default ('uppsc', see migration 0106) rather than
   * writing anything. Same enum as ProfileUpdateBody.target_exam; the API
   * layer runs it through the identical assertSelectableExam guard before
   * persisting.
   */
  target_exam: targetExamCodeSchema.optional(),
});
export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

export const profileResponseSchema = apiEnvelopeSchema(profileSchema);
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
