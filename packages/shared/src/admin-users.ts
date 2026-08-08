import { z } from "zod";
import { apiEnvelopeSchema, paginatedSchema } from "./types";
import { userPlanSchema } from "./profile";
import { targetExamCodeSchema } from "./exams";

/**
 * The admin "Users" surface — browse every account (paginated, newest first),
 * optionally narrowed by an email/display-name filter, then grant/revoke Pro
 * access or admin privilege. Every action is logged to `admin_grants`
 * (migration 0117) for auditability. This does NOT introduce a parallel
 * access-control field: Pro access is still `users_profile.plan` +
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

/** `query`, when present, matches against email OR display name (substring, case-insensitive). */
export const adminUserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  query: z.string().trim().max(320).optional(),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserListResponseSchema = apiEnvelopeSchema(paginatedSchema(adminUserSummarySchema));
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

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
