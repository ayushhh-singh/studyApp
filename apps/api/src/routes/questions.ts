import { Router } from "express";
import { z } from "zod";
import { questionResponseSchema, questionsQuerySchema, questionsResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getQuestionById, listQuestions, QUESTIONS_PAGE_SIZE } from "../services/questions.js";

export const questionsRouter = Router();
questionsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

questionsRouter.get(
  "/questions",
  asyncHandler(async (req, res) => {
    const query = parse(questionsQuerySchema, req.query);
    const { items, total } = await listQuestions(query);
    res.json(
      questionsResponseSchema.parse({
        data: {
          items,
          pagination: {
            page: query.page,
            page_size: QUESTIONS_PAGE_SIZE,
            total,
            total_pages: Math.max(1, Math.ceil(total / QUESTIONS_PAGE_SIZE)),
          },
        },
        error: null,
      }),
    );
  }),
);

const questionIdParams = z.object({ id: z.string().uuid() });

questionsRouter.get(
  "/questions/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(questionIdParams, req.params);
    const question = await getQuestionById(id);
    res.json(questionResponseSchema.parse({ data: question, error: null }));
  }),
);
