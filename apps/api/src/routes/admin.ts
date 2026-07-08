import { Router } from "express";
import { z } from "zod";
import {
  adminStatusResponseSchema,
  reviewActionResponseSchema,
  reviewBulkApproveBodySchema,
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
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { isCurrentUserAdmin, requireAdmin } from "../lib/admin.js";
import { currentUserId } from "../lib/user-context.js";
import {
  approveQuestion,
  bulkApprove,
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

export const adminRouter = Router();

/** Lets the SPA decide whether to render the Review Queue — true only for admins. */
adminRouter.get(
  "/admin/status",
  asyncHandler(async (_req, res) => {
    res.json(
      adminStatusResponseSchema.parse({ data: { admin_mode: await isCurrentUserAdmin() }, error: null }),
    );
  }),
);

// Everything below is admin-gated.
adminRouter.use("/admin/review", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/notes", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));
adminRouter.use("/admin/community", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));

adminRouter.get(
  "/admin/review",
  asyncHandler(async (req, res) => {
    const { tab, page } = parse(reviewQueueQuerySchema, req.query);
    const { items, total } = await listReviewQueue(tab, page);
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
  asyncHandler(async (_req, res) => {
    res.json(reviewCountsResponseSchema.parse({ data: await reviewCounts(), error: null }));
  }),
);

adminRouter.post(
  "/admin/review/bulk-approve",
  asyncHandler(async (req, res) => {
    const { ids } = parse(reviewBulkApproveBodySchema, req.body);
    res.json(reviewActionResponseSchema.parse({ data: await bulkApprove(ids), error: null }));
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
