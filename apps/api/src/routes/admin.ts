import { Router } from "express";
import { z } from "zod";
import {
  adminStatusResponseSchema,
  adminGrantLogResponseSchema,
  adminGrantProBodySchema,
  adminUserActionResponseSchema,
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  caBulkApproveHighConfidenceBodySchema,
  caHighConfidenceCountResponseSchema,
  caHighConfidenceQuerySchema,
  reviewActionResponseSchema,
  reviewBulkApproveBodySchema,
  reviewCountsQuerySchema,
  reviewCountsResponseSchema,
  reviewEditBodySchema,
  reviewQueueQuerySchema,
  reviewQueueResponseSchema,
  reviewRejectBodySchema,
  reviewNoteActionResponseSchema,
  reviewNoteEditBodySchema,
  reviewNoteRejectBodySchema,
  reviewNotesQuerySchema,
  reviewNotesResponseSchema,
  reportActionResponseSchema,
  reportsQueueQuerySchema,
  reportsQueueResponseSchema,
  reportTargetTypeSchema,
  resolveReportBodySchema,
  reviewMagazineEditBodySchema,
  reviewMagazineQuerySchema,
  reviewMagazineRejectBodySchema,
  reviewMagazineResponseSchema,
  reviewMagazineActionResponseSchema,
  questionReportsQueueQuerySchema,
  questionReportsQueueResponseSchema,
  questionReportActionResponseSchema,
  resolveQuestionReportBodySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { isCurrentUserAdmin, requireAdmin } from "../lib/admin.js";
import { currentUserId } from "../lib/user-context.js";
import { razorpayStatus } from "../lib/razorpay.js";
import {
  approveQuestion,
  bulkApprove,
  bulkApproveCaHighConfidence,
  caHighConfidenceCount,
  editQuestion,
  listReviewQueue,
  rejectQuestion,
  reviewCounts,
  REVIEW_PAGE_SIZE,
} from "../services/review.js";
import {
  approveNote,
  editNote,
  listReviewNotes,
  NOTES_REVIEW_PAGE_SIZE,
  rejectNote,
} from "../services/notes.js";
import { listReportsQueue, REPORTS_PAGE_SIZE, resolveReportsForTarget } from "../services/community-admin.js";
import {
  listQuestionReportsQueue,
  QUESTION_REPORTS_PAGE_SIZE,
  resolveQuestionReport,
} from "../services/question-reports.js";
import {
  approveMagazineDeepDive,
  editMagazineDeepDive,
  listReviewMagazine,
  MAGAZINE_REVIEW_PAGE_SIZE,
  rejectMagazineDeepDive,
} from "../services/magazine.js";
import {
  ADMIN_USER_LIST_PAGE_SIZE,
  getGrantLog,
  grantAdmin,
  grantPro,
  listUsers,
  revokeAdmin,
  revokePro,
} from "../services/admin-users.js";

export const adminRouter = Router();

/** Lets the SPA decide whether to render the Review Queue — true only for admins.
 * Also surfaces the active Razorpay TEST/LIVE mode to admins (null otherwise) so
 * the payment mode is verifiable in-app without exposing it to every user. */
adminRouter.get(
  "/admin/status",
  asyncHandler(async (_req, res) => {
    const admin = await isCurrentUserAdmin();
    const s = admin ? razorpayStatus() : null;
    res.json(
      adminStatusResponseSchema.parse({
        data: {
          admin_mode: admin,
          billing: s
            ? { configured: s.configured, mode: s.mode, misconfigured: s.misconfigured, detail: s.detail }
            : null,
        },
        error: null,
      }),
    );
  }),
);

// Everything below is admin-gated.
adminRouter.use("/admin/review", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/notes", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/community", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/question-reports", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/magazine", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
// Tighter than the review-queue surfaces above: this gates real financial
// (Pro plan) and privilege (is_admin) changes, not content review.
adminRouter.use("/admin/users", requireAdmin, rateLimit({ windowMs: 60_000, max: 60 }));

adminRouter.get(
  "/admin/review",
  asyncHandler(async (req, res) => {
    const { tab, page, exam } = parse(reviewQueueQuerySchema, req.query);
    const { items, total } = await listReviewQueue(tab, page, exam);
    res.json(
      reviewQueueResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: REVIEW_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

adminRouter.get(
  "/admin/review/counts",
  asyncHandler(async (req, res) => {
    const { exam } = parse(reviewCountsQuerySchema, req.query);
    res.json(reviewCountsResponseSchema.parse({ data: await reviewCounts(exam), error: null }));
  }),
);

adminRouter.post(
  "/admin/review/bulk-approve",
  asyncHandler(async (req, res) => {
    const { ids } = parse(reviewBulkApproveBodySchema, req.body);
    res.json(reviewActionResponseSchema.parse({ data: await bulkApprove(ids), error: null }));
  }),
);

// Current Affairs high-confidence bulk approve: unlike the page-scoped bulk
// approve above (max 100 ids the client already has loaded), this acts on the
// ENTIRE needs_review CA backlog for ONE exam server-side — the count
// endpoint lets the Review Queue's CA tab show the number before the admin
// commits to it.
adminRouter.get(
  "/admin/review/current-affairs/high-confidence-count",
  asyncHandler(async (req, res) => {
    const { exam } = parse(caHighConfidenceQuerySchema, req.query);
    res.json(caHighConfidenceCountResponseSchema.parse({ data: { count: await caHighConfidenceCount(exam) }, error: null }));
  }),
);

adminRouter.post(
  "/admin/review/current-affairs/bulk-approve-high-confidence",
  asyncHandler(async (req, res) => {
    const { exam } = parse(caBulkApproveHighConfidenceBodySchema, req.body);
    res.json(reviewActionResponseSchema.parse({ data: await bulkApproveCaHighConfidence(exam), error: null }));
  }),
);

const idParams = z.object({ id: z.string().uuid() });

adminRouter.post(
  "/admin/review/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(reviewActionResponseSchema.parse({ data: await approveQuestion(id), error: null }));
  }),
);

adminRouter.post(
  "/admin/review/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(reviewRejectBodySchema, req.body);
    res.json(reviewActionResponseSchema.parse({ data: await rejectQuestion(id, reason), error: null }));
  }),
);

adminRouter.patch(
  "/admin/review/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(reviewEditBodySchema, req.body);
    res.json(reviewActionResponseSchema.parse({ data: await editQuestion(id, body), error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Notes review (the Review Queue's Notes tab). Notes are structurally unlike
// questions, so they get their own list/action endpoints under /admin/notes.
// ---------------------------------------------------------------------------
adminRouter.get(
  "/admin/notes/review",
  asyncHandler(async (req, res) => {
    const { page } = parse(reviewNotesQuerySchema, req.query);
    const { items, total } = await listReviewNotes(page);
    res.json(
      reviewNotesResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: NOTES_REVIEW_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / NOTES_REVIEW_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

adminRouter.post(
  "/admin/notes/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(reviewNoteActionResponseSchema.parse({ data: await approveNote(id), error: null }));
  }),
);

adminRouter.post(
  "/admin/notes/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(reviewNoteRejectBodySchema, req.body);
    res.json(reviewNoteActionResponseSchema.parse({ data: await rejectNote(id, reason), error: null }));
  }),
);

adminRouter.patch(
  "/admin/notes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(reviewNoteEditBodySchema, req.body);
    res.json(reviewNoteActionResponseSchema.parse({ data: await editNote(id, body), error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Community reports (the Review Queue's Reports tab). Reports are user
// complaints about user-generated content, not AI-generated drafts awaiting a
// publish gate, so — like notes above — they get their own list/counts/action
// endpoints rather than reusing listReviewQueue's questions-shaped machinery.
// ---------------------------------------------------------------------------
adminRouter.get(
  "/admin/community/reports",
  asyncHandler(async (req, res) => {
    const { page } = parse(reportsQueueQuerySchema, req.query);
    const { items, total } = await listReportsQueue(page);
    res.json(
      reportsQueueResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: REPORTS_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

const reportTargetParams = z.object({ targetType: reportTargetTypeSchema, targetId: z.string().uuid() });

adminRouter.post(
  "/admin/community/reports/:targetType/:targetId/resolve",
  asyncHandler(async (req, res) => {
    const { targetType, targetId } = parse(reportTargetParams, req.params);
    const { action } = parse(resolveReportBodySchema, req.body);
    const result = await resolveReportsForTarget(currentUserId(), targetType, targetId, action);
    res.json(reportActionResponseSchema.parse({ data: result, error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Question reports (the Review Queue's "Reported questions" tab). User "Report
// this question" complaints, grouped by question, with full provenance. Admin
// actions fix the key / regenerate the explanation / unpublish / dismiss.
// ---------------------------------------------------------------------------
adminRouter.get(
  "/admin/question-reports",
  asyncHandler(async (req, res) => {
    const { page } = parse(questionReportsQueueQuerySchema, req.query);
    const { items, total } = await listQuestionReportsQueue(page);
    res.json(
      questionReportsQueueResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: QUESTION_REPORTS_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / QUESTION_REPORTS_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

adminRouter.post(
  "/admin/question-reports/:id/resolve",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { action, correct_option_key } = parse(resolveQuestionReportBodySchema, req.body);
    const result = await resolveQuestionReport(currentUserId(), id, action, correct_option_key);
    res.json(questionReportActionResponseSchema.parse({ data: result, error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Magazine deep-dive review (the Review Queue's Magazine tab). A deep dive is
// not a `questions` row, so — like notes/reports above — it gets its own
// list/action endpoints rather than services/review.ts's applyTab.
// ---------------------------------------------------------------------------
adminRouter.get(
  "/admin/magazine/review",
  asyncHandler(async (req, res) => {
    const { page } = parse(reviewMagazineQuerySchema, req.query);
    const { items, total } = await listReviewMagazine(page);
    res.json(
      reviewMagazineResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: MAGAZINE_REVIEW_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / MAGAZINE_REVIEW_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

adminRouter.post(
  "/admin/magazine/:id/approve",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(reviewMagazineActionResponseSchema.parse({ data: await approveMagazineDeepDive(id), error: null }));
  }),
);

adminRouter.post(
  "/admin/magazine/:id/reject",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(reviewMagazineRejectBodySchema, req.body);
    res.json(reviewMagazineActionResponseSchema.parse({ data: await rejectMagazineDeepDive(id, reason), error: null }));
  }),
);

adminRouter.patch(
  "/admin/magazine/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(reviewMagazineEditBodySchema, req.body);
    res.json(reviewMagazineActionResponseSchema.parse({ data: await editMagazineDeepDive(id, body), error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Admin "Users" — search a specific account by email, grant/revoke Pro access
// or admin privilege. Every mutating action is logged to `admin_grants`
// (migration 0117); see services/admin-users.ts for the full design notes
// (why a grant is indefinite, why self-revoke-admin is blocked).
// ---------------------------------------------------------------------------
adminRouter.get(
  "/admin/users",
  asyncHandler(async (req, res) => {
    const { page, query } = parse(adminUserListQuerySchema, req.query);
    const { items, total } = await listUsers({ page, query });
    res.json(
      adminUserListResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: ADMIN_USER_LIST_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / ADMIN_USER_LIST_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

adminRouter.get(
  "/admin/users/:id/grants",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(adminGrantLogResponseSchema.parse({ data: await getGrantLog(id), error: null }));
  }),
);

adminRouter.post(
  "/admin/users/:id/grant-pro",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const { days } = parse(adminGrantProBodySchema, req.body ?? {});
    res.json(adminUserActionResponseSchema.parse({ data: await grantPro(currentUserId(), id, days ?? null), error: null }));
  }),
);

adminRouter.post(
  "/admin/users/:id/revoke-pro",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(adminUserActionResponseSchema.parse({ data: await revokePro(currentUserId(), id), error: null }));
  }),
);

adminRouter.post(
  "/admin/users/:id/grant-admin",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(adminUserActionResponseSchema.parse({ data: await grantAdmin(currentUserId(), id), error: null }));
  }),
);

adminRouter.post(
  "/admin/users/:id/revoke-admin",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json(adminUserActionResponseSchema.parse({ data: await revokeAdmin(currentUserId(), id), error: null }));
  }),
);
