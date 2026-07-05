import { z } from "zod";
import { apiEnvelopeSchema, localeSchema } from "./types";

export const userPlanSchema = z.enum(["free", "pro"]);
export type UserPlan = z.infer<typeof userPlanSchema>;

export const profileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  preferred_locale: localeSchema,
  target_exam_year: z.number().int().nullable(),
  medium: localeSchema,
  plan: userPlanSchema,
  streak_count: z.number().int(),
  last_active_date: z.string().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileUpdateBodySchema = z
  .object({
    display_name: z.string().min(1).max(120).optional(),
    preferred_locale: localeSchema.optional(),
    target_exam_year: z.number().int().min(2000).max(2100).optional(),
    medium: localeSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type ProfileUpdateBody = z.infer<typeof profileUpdateBodySchema>;

export const profileResponseSchema = apiEnvelopeSchema(profileSchema);
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
