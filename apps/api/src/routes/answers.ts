import { Router } from "express";
import { z } from "zod";
import {
  confirmOcrBodySchema,
  createSubmissionBodySchema,
  dailyAnswerSetResponseSchema,
  submissionDetailResponseSchema,
  submissionListResponseSchema,
  submissionResponseSchema,
  todaysQuestionResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import {
  confirmOcr,
  createSubmission,
  getSubmissionDetail,
  listSubmissions,
  SUBMISSIONS_PAGE_SIZE,
} from "../services/evaluation/evaluate.js";
import { getTodaysQuestion } from "../services/questions.js";
import { getDailyAnswerSet } from "../services/answer-set.js";

/**
 * Answer-writing evaluation (flagship). Submissions are created here; the
 * two-pass evaluation itself streams over SSE at
 * GET /api/v1/stream/evaluations/:submissionId (see routes/stream.ts).
 */
export const answersRouter = Router();
answersRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

const submissionIdParams = z.object({ submissionId: z.string().uuid() });
const listQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });

answersRouter.get(
  "/answers/today",
  asyncHandler(async (_req, res) => {
    const question = await getTodaysQuestion();
    res.json(todaysQuestionResponseSchema.parse({ data: question, error: null }));
  }),
);

answersRouter.get(
  "/answers/daily-set",
  asyncHandler(async (_req, res) => {
    const set = await getDailyAnswerSet(devUserId());
    res.json(dailyAnswerSetResponseSchema.parse({ data: set, error: null }));
  }),
);

answersRouter.get(
  "/answers/submissions",
  asyncHandler(async (req, res) => {
    const { page } = parse(listQuerySchema, req.query);
    const { items, total } = await listSubmissions(devUserId(), page);
    res.json(
      submissionListResponseSchema.parse({
        data: {
          items,
          pagination: {
            page,
            page_size: SUBMISSIONS_PAGE_SIZE,
            total,
            total_pages: Math.ceil(total / SUBMISSIONS_PAGE_SIZE),
          },
        },
        error: null,
      }),
    );
  }),
);

answersRouter.post(
  "/answers/submissions",
  asyncHandler(async (req, res) => {
    const body = parse(createSubmissionBodySchema, req.body);
    const submission = await createSubmission(devUserId(), body);
    res.status(201).json(submissionResponseSchema.parse({ data: submission, error: null }));
  }),
);

answersRouter.get(
  "/answers/submissions/:submissionId",
  asyncHandler(async (req, res) => {
    const { submissionId } = parse(submissionIdParams, req.params);
    const detail = await getSubmissionDetail(devUserId(), submissionId);
    res.json(submissionDetailResponseSchema.parse({ data: detail, error: null }));
  }),
);

/**
 * Trust-loop confirm step for a handwritten submission: persists the user's
 * reviewed/edited OCR transcription as typed_text. The actual transcription
 * runs at GET /stream/evaluations/:submissionId's sibling,
 * GET /stream/ocr/:submissionId (see routes/stream.ts).
 */
answersRouter.patch(
  "/answers/submissions/:submissionId/confirm-ocr",
  asyncHandler(async (req, res) => {
    const { submissionId } = parse(submissionIdParams, req.params);
    const { text } = parse(confirmOcrBodySchema, req.body);
    const submission = await confirmOcr(devUserId(), submissionId, text);
    res.json(submissionResponseSchema.parse({ data: submission, error: null }));
  }),
);
