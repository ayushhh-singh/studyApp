import { z } from "zod";
import { apiEnvelopeSchema } from "./types";
import { userPlanSchema } from "./profile";
import { targetExamCodeSchema } from "./exams";

/**
 * The admin "Users" surface — search a specific account by email and
 * grant/revoke Pro access or admin privilege, with every action logged to
 * `admin_grants` (migration 0117) for auditability. This does NOT introduce a
 * parallel access-control field: Pro access is still `users_profile.plan` +
 * `plan_expires_at` (the same field `services/entitlements.ts::getPlanFor`
 * reads for every metered endpoint), and admin access is still
 * `users_profile.is_admin` (`lib/admin.ts::requireAdmin`). This module only
 * adds a UI + audit trail on top of those existing fields.
 */

export const adminGrantActionSchema = z.enum(["grant_pro", "revoke_pro", "grant_admin", "revoke_admin"]);
export type AdminGrantAction = z.infer<typeof adminGrantActionSchema>;

/** One account's access-relevant profile, as the admin Users page renders it. */
export const adminUserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  is_anonymous: z.boolean(),
  display_name: z.string().nullable(),
  plan: userPlanSchema,
  plan_expires_at: z.string().nullable(),
  /** Distinguishes a signup-trial Pro grant from a manual/admin one (entitlements.ts). */
  has_used_trial: z.boolean(),
  is_admin: z.boolean(),
  target_exam: targetExamCodeSchema,
  created_at: z.string(),
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserSearchQuerySchema = z.object({
  email: z.string().trim().min(1).max(320),
});
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuerySchema>;

/** null = no account found for that email — a real, expected outcome, not an error. */
export const adminUserSearchResponseSchema = apiEnvelopeSchema(adminUserSummarySchema.nullable());
export type AdminUserSearchResponse = z.infer<typeof adminUserSearchResponseSchema>;

export const adminUserActionResponseSchema = apiEnvelopeSchema(adminUserSummarySchema);
export type AdminUserActionResponse = z.infer<typeof adminUserActionResponseSchema>;

/** One row of the audit trail, with the acting admin's email resolved for display. */
export const adminGrantLogEntrySchema = z.object({
  id: z.string().uuid(),
  admin_user_id: z.string().uuid().nullable(),
  admin_email: z.string().nullable(),
  action: adminGrantActionSchema,
  detail: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type AdminGrantLogEntry = z.infer<typeof adminGrantLogEntrySchema>;

export const adminGrantLogResponseSchema = apiEnvelopeSchema(z.array(adminGrantLogEntrySchema));
export type AdminGrantLogResponse = z.infer<typeof adminGrantLogResponseSchema>;
