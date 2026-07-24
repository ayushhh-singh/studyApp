import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

/**
 * Sukoon (wellness companion) shared contract — see SUKOON_CONTEXT.md /
 * sukoon-build-blueprint.md. Lives in @neev/shared like every other feature's
 * schemas (the shared package is a neutral util, not a Neev *feature* module,
 * so importing it from the Sukoon frontend/backend respects the isolation
 * rule). If Sukoon is ever extracted to a standalone repo, this one file moves
 * with it.
 */

/**
 * CHAT language preference (what Saathi replies in) — NOT the UI language. The
 * UI still follows Neev's global hi/en toggle; Hinglish is a conversational
 * register only, never a UI locale.
 */
export const sukoonChatLanguageSchema = z.enum(["hi", "en", "hinglish"]);
export type SukoonChatLanguage = z.infer<typeof sukoonChatLanguageSchema>;

/** A local wall-clock reminder time, "HH:MM" (24h). */
const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

/** An ISO calendar date, "YYYY-MM-DD". */
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * WHO-5 Wellbeing Index (public-domain, wellness-framed — NOT a clinical
 * screener). Exactly 5 items, each 0 ("at no time") … 5 ("all of the time").
 */
export const who5AnswersSchema = z.array(z.number().int().min(0).max(5)).length(5);
export type Who5Answers = z.infer<typeof who5AnswersSchema>;

/** The Sukoon profile row returned to the client (sukoon_profiles). */
export const sukoonProfileSchema = z.object({
  user_id: z.string().uuid(),
  language: sukoonChatLanguageSchema,
  exam: z.string().nullable(),
  exam_attempt: z.number().int().nullable(),
  exam_date: z.string().nullable(),
  restricted_mode: z.boolean(),
  voice_pref: z.string().nullable(),
  reminder_time: z.string().nullable(),
  onboarding_completed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SukoonProfile = z.infer<typeof sukoonProfileSchema>;

/**
 * Onboarding submission (F1). `age_confirmed_18` false → the server sets
 * restricted_mode=true (under-18: no open chat; DPDP caution). `consent_accepted`
 * MUST be literal true — the consent version itself is a server-side constant,
 * never sent by the client, so the client can only ATTEST, not choose a version.
 */
export const sukoonOnboardingBodySchema = z.object({
  language: sukoonChatLanguageSchema,
  consent_accepted: z.literal(true),
  age_confirmed_18: z.boolean(),
  who5: who5AnswersSchema.nullable().optional(),
  exam: z.string().trim().min(1).max(120).nullable().optional(),
  exam_attempt: z.number().int().min(0).max(20).nullable().optional(),
  exam_date: isoDateSchema.nullable().optional(),
  reminder_time: reminderTimeSchema.nullable().optional(),
});
export type SukoonOnboardingBody = z.infer<typeof sukoonOnboardingBodySchema>;

/**
 * PATCH /profile — a partial patch of user-editable fields. restricted_mode is
 * DELIBERATELY not here: it is set once by the onboarding age gate and must not
 * be client-flippable (that would let an under-18 account unlock open chat).
 */
export const sukoonProfileUpdateBodySchema = z
  .object({
    language: sukoonChatLanguageSchema.optional(),
    exam: z.string().trim().min(1).max(120).nullable().optional(),
    exam_attempt: z.number().int().min(0).max(20).nullable().optional(),
    exam_date: isoDateSchema.nullable().optional(),
    reminder_time: reminderTimeSchema.nullable().optional(),
    voice_pref: z.string().max(60).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type SukoonProfileUpdateBody = z.infer<typeof sukoonProfileUpdateBodySchema>;

/**
 * GET /profile returns { profile } where profile is null before onboarding —
 * a normal, expected state (not a 404), which the onboarding gate reads to
 * decide whether to redirect. Wrapping it keeps the envelope's `data` a stable
 * object shape rather than a nullable that the typed api client would mis-narrow.
 */
export const sukoonProfileResponseSchema = apiEnvelopeSchema(
  z.object({ profile: sukoonProfileSchema.nullable() }),
);
export type SukoonProfileResponse = z.infer<typeof sukoonProfileResponseSchema>;

/** POST /onboarding and PATCH /profile both return the freshly-written profile. */
export const sukoonProfileWriteResponseSchema = apiEnvelopeSchema(sukoonProfileSchema);
export type SukoonProfileWriteResponse = z.infer<typeof sukoonProfileWriteResponseSchema>;
