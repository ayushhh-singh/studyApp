import { z } from "zod";
import { apiEnvelopeSchema, paginatedSchema } from "./types";
import { userPlanSchema } from "./profile";
import { targetExamCodeSchema } from "./exams";
import { attemptListItemSchema } from "./tests";

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

export const adminGrantActionSchema = z.enum([
  "grant_pro",
  "revoke_pro",
  "grant_max",
  "revoke_max",
  "grant_admin",
  "revoke_admin",
]);
export type AdminGrantAction = z.infer<typeof adminGrantActionSchema>;

/**
 * The tiers an admin can grant. Excludes 'free' by construction — dropping to
 * free is `revoke`, not a grant, so this cannot be called with a nonsense tier.
 */
export const paidTierSchema = z.enum(["pro", "max"]);
export type PaidTier = z.infer<typeof paidTierSchema>;

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

/* ------------------------------------------------------------------------- *
 * Per-user drill-down
 * ------------------------------------------------------------------------- */

/**
 * One row of the drill-down's test history: the SAME `AttemptListItem` the
 * user's own Practice → History tab renders, plus a rank where one exists.
 *
 * ⚑ RANK IS NULL FOR MOST ROWS, BY DESIGN, NOT BECAUSE IT FAILED TO LOAD.
 * `mv_test_leaderboard` (0067) only admits `mock`/`sectional` tests, only each
 * user's FIRST attempt on a given test, and only published tests — so daily
 * quizzes, PYQ practice, custom sets, time attack and every re-attempt
 * legitimately have no rank at all. The UI must render that absence as "not
 * ranked", never as a missing/pending value. `cohort_size` is null exactly when
 * `user_rank` is.
 */
export const adminUserAttemptSchema = attemptListItemSchema.extend({
  user_rank: z.number().int().nullable(),
  cohort_size: z.number().int().nullable(),
});
export type AdminUserAttempt = z.infer<typeof adminUserAttemptSchema>;

export const adminUserAttemptsResponseSchema = apiEnvelopeSchema(paginatedSchema(adminUserAttemptSchema));
export type AdminUserAttemptsResponse = z.infer<typeof adminUserAttemptsResponseSchema>;

/** Declared inline rather than shared — matches the per-module convention (postsQuerySchema, reportsQueueQuerySchema, …). */
export const adminUserAttemptsQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
export type AdminUserAttemptsQuery = z.infer<typeof adminUserAttemptsQuerySchema>;

/* ------------------------------------------------------------------------- *
 * Per-user LLM cost attribution
 * ------------------------------------------------------------------------- */

/** One AI-calling action type this user triggered, with what it really cost. */
export const adminUserCostPurposeSchema = z.object({
  /** The raw `llm_calls.purpose` (e.g. "answer_eval_analysis", "mentor_doubt"). */
  purpose: z.string(),
  calls: z.number().int(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cost_usd: z.number(),
});
export type AdminUserCostPurpose = z.infer<typeof adminUserCostPurposeSchema>;

/**
 * What this user's AI usage actually cost, rolled up from real `llm_calls`
 * rows.
 *
 * ⚑ THIS IS ATTRIBUTABLE SPEND, NOT THIS USER'S SHARE OF TOTAL SPEND — the
 * distinction matters for reading the number correctly. Only calls made in a
 * request context carry a `user_id`; the content pipelines (`ca_*`, `ingest_*`,
 * `qgen_*`, `notes_*`, `audit_*`) run from cron/CLI with no request user and are
 * a much larger share of total spend, correctly attributed to nobody. So a
 * per-user figure answers "what did serving THIS user cost", not "what fraction
 * of the bill is theirs".
 *
 * ⚑ AND IT UNDERSTATES, in one known way that cannot be recovered:
 * `llm_calls.user_id` is `on delete set null`, so when an account is deleted its
 * spend becomes permanently unattributable. That affects historical totals, not
 * a live user's own figure.
 *
 * Figures are RECOMPUTED from the token columns under the price schedule in
 * effect at each call's own timestamp — the same choice `cost:report` makes, so
 * the two surfaces agree — rather than summing the stored `cost_usd`. See
 * `lib/llm-cost.ts` for why.
 */
export const adminUserCostSchema = z.object({
  total_cost_usd: z.number(),
  total_calls: z.number().int(),
  /** Descending by cost — the expensive actions first. */
  by_purpose: z.array(adminUserCostPurposeSchema),
  /** ISO date of this user's first attributable call, or null if they have none. */
  first_call_at: z.string().nullable(),
  last_call_at: z.string().nullable(),
  /**
   * Rows whose `model` has no MODEL_PRICING entry (a retired id, or a sibling
   * app sharing this database). Surfaced rather than silently dropped or priced
   * at zero, so a non-zero count explains why the total may be low.
   */
  unpriced_calls: z.number().int(),
});
export type AdminUserCost = z.infer<typeof adminUserCostSchema>;

export const adminUserCostResponseSchema = apiEnvelopeSchema(adminUserCostSchema);
export type AdminUserCostResponse = z.infer<typeof adminUserCostResponseSchema>;

/**
 * The non-paginated half of the drill-down: who this account is, how engaged it
 * is, and what its revision practice looks like.
 *
 * SRS numbers are the four scalars from the user's own `GET /srs/stats`
 * (`services/srs.ts::getStats`), computed by that exact function so an admin and
 * the student cannot read different figures. Its 7-day `forecast` array is
 * deliberately NOT carried through — it is a study-planning aid for the learner,
 * not a usage signal for a product owner, and it would triple this payload.
 */
export const adminUserStatsSchema = z.object({
  user: adminUserListRowSchema,
  streak: z.object({
    streak_count: z.number().int(),
    streak_freezes: z.number().int(),
    streak_freeze_used_on: z.string().nullable(),
    /**
     * The streak engine's own notion of the last STUDY day. Kept alongside
     * `user.last_active_at` (a max() over five activity tables) rather than
     * instead of it: the two answer different questions, and a wide gap between
     * them is itself the interesting signal — "opens the app daily but never
     * completes anything".
     */
    last_active_date: z.string().nullable(),
  }),
  srs: z.object({
    total_cards: z.number().int(),
    due_today: z.number().int(),
    reviewed_today: z.number().int(),
    /** null when there is no review history in the 30-day lookback window. */
    retention_pct: z.number().nullable(),
  }),
});
export type AdminUserStats = z.infer<typeof adminUserStatsSchema>;

export const adminUserStatsResponseSchema = apiEnvelopeSchema(adminUserStatsSchema);
export type AdminUserStatsResponse = z.infer<typeof adminUserStatsResponseSchema>;

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
export const adminGrantPlanBodySchema = z.object({
  days: z.number().int().positive().max(3650).nullable().optional(),
  /**
   * Which paid tier to grant. Defaults to 'pro' so an older client that predates
   * the Max tier keeps its exact previous behaviour rather than silently
   * granting the wrong (higher) tier.
   */
  tier: paidTierSchema.default("pro"),
});
export type AdminGrantPlanBody = z.infer<typeof adminGrantPlanBodySchema>;

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
