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

/**
 * One row of the admin Users LIST — an `AdminUserSummary` plus the activity
 * signals a product owner scans the list for.
 *
 * Deliberately a SEPARATE type rather than four more fields on
 * `adminUserSummarySchema`: that summary is the response shape of the four
 * grant/revoke endpoints, which are about ACCESS CONTROL and have no use for
 * activity counts. Widening it would make every grant response pay for an
 * extra aggregate query to populate fields its caller ignores. So:
 * summary = access-control state, list row = summary + activity.
 */
export const adminUserListRowSchema = adminUserSummarySchema.extend({
  /**
   * Last genuinely-active moment, or null for an account that has never done
   * anything. NOT `users_profile.last_active_date` — that column is only
   * written on a study-DAY activity, so a user who reads chapters daily but
   * never completes a study action would look inactive. This is a max() across
   * the same five durable-activity tables `pruneAbandonedGuests` treats as
   * "active" (events, attempts, srs_reviews, srs_cards, user_notes), so the
   * admin list and the guest-retention job cannot disagree about the word.
   */
  last_active_at: z.string().nullable(),
  /** SUBMITTED attempts only — an abandoned attempt row exists from the moment the player opens. */
  tests_taken: z.number().int(),
  srs_reviews_count: z.number().int(),
  /** `users_profile.streak_count` — the live streak the dashboard/TopBar flame renders. */
  streak_count: z.number().int(),
});
export type AdminUserListRow = z.infer<typeof adminUserListRowSchema>;

export const adminUserListResponseSchema = apiEnvelopeSchema(paginatedSchema(adminUserListRowSchema));
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

export const adminUserActionResponseSchema = apiEnvelopeSchema(adminUserSummarySchema);
export type AdminUserActionResponse = z.infer<typeof adminUserActionResponseSchema>;

/**
 * `days` is OPTIONAL — omit (or null) for the original indefinite grant.
 * When set, the Pro grant expires `days` days from now instead of never.
 *
 * ⚑ CAVEAT surfaced in the UI, not hidden: `getTrialContext`'s `isOnTrial`
 * (services/entitlements.ts) reads plan='pro' + an EXPIRY + has_used_trial
 * together as "this is the 7-day signup trial". A time-limited grant to an
 * account that already burned its real trial (`has_used_trial=true`) will
 * therefore be read as trial-tier limits (2 evals/day), not full Pro
 * (60/month) — the same fields, read the same way, regardless of who set
 * them. An INDEFINITE grant never has this ambiguity (no expiry → never
 * looks like a trial). This is a property of the existing, twice-audited
 * trial-detection logic, not something this endpoint can silently avoid
 * without touching that logic — so the admin-users UI shows a warning at the
 * moment it applies rather than letting a time-boxed grant silently under-serve.
 */
export const adminGrantProBodySchema = z.object({
  days: z.number().int().positive().max(3650).nullable().optional(),
});
export type AdminGrantProBody = z.infer<typeof adminGrantProBodySchema>;

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
