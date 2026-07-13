/**
 * User-facing "Report this question" endpoint. Admin triage (list + resolve)
 * lives in routes/admin.ts under /admin/question-reports.
 */
import { Router } from "express";
import { z } from "zod";
import { createQuestionReportBodySchema, questionReportResultResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { createQuestionReport } from "../services/question-reports.js";

export const questionReportsRouter = Router();

const idParams = z.object({ id: z.string().uuid() });

questionReportsRouter.post(
  "/questions/:id/reports",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const body = parse(createQuestionReportBodySchema, req.body);
    const result = await createQuestionReport(currentUserId(), id, body);
    res.json(questionReportResultResponseSchema.parse({ data: result, error: null }));
  }),
);
