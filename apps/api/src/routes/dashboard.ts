import { Router } from "express";
import { dashboardSummaryResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getDashboardSummary } from "../services/dashboard.js";

export const dashboardRouter = Router();
dashboardRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

dashboardRouter.get(
  "/dashboard/summary",
  asyncHandler(async (_req, res) => {
    const summary = await getDashboardSummary(devUserId());
    res.json(dashboardSummaryResponseSchema.parse({ data: summary, error: null }));
  }),
);
