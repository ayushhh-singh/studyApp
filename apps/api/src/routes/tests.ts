import { Router } from "express";
import { z } from "zod";
import { testDetailResponseSchema, testsListResponseSchema, testsQuerySchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getTestDetail, listTests } from "../services/tests.js";

export const testsRouter = Router();
testsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

testsRouter.get(
  "/tests",
  asyncHandler(async (req, res) => {
    const query = parse(testsQuerySchema, req.query);
    const tests = await listTests(query);
    res.json(testsListResponseSchema.parse({ data: tests, error: null }));
  }),
);

testsRouter.get(
  "/tests/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const test = await getTestDetail(id);
    res.json(testDetailResponseSchema.parse({ data: test, error: null }));
  }),
);
