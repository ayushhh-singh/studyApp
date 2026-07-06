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
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { isAdminMode, requireAdmin } from "../lib/admin.js";
import {
  approveQuestion,
  bulkApprove,
  editQuestion,
  listReviewQueue,
  rejectQuestion,
  reviewCounts,
  REVIEW_PAGE_SIZE,
} from "../services/review.js";

export const adminRouter = Router();

/** Public: lets the SPA decide whether to render the Review Queue at all. */
adminRouter.get(
  "/admin/status",
  asyncHandler(async (_req, res) => {
    res.json(adminStatusResponseSchema.parse({ data: { admin_mode: isAdminMode() }, error: null }));
  }),
);

// Everything below is admin-gated.
adminRouter.use("/admin/review", requireAdmin, rateLimit({ windowMs: 60_000, max: 300 }));

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
