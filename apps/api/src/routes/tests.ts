import { Router } from "express";
import { z } from "zod";
import {
  createCustomAnswerTestBodySchema,
  createCustomTestBodySchema,
  testDetailResponseSchema,
  testsListResponseSchema,
  testsQuerySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { createCustomAnswerTest, createCustomTestFromNode, getTestDetail, listTests } from "../services/tests.js";

export const testsRouter = Router();
testsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

testsRouter.post(
  "/tests/custom",
  asyncHandler(async (req, res) => {
    const body = parse(createCustomTestBodySchema, req.body);
    const test = await createCustomTestFromNode(body);
    res.status(201).json(testDetailResponseSchema.parse({ data: test, error: null }));
  }),
);

testsRouter.post(
  "/tests/custom-answer",
  asyncHandler(async (req, res) => {
    const body = parse(createCustomAnswerTestBodySchema, req.body);
    const test = await createCustomAnswerTest(body.node_ids, body.count);
    res.status(201).json(testDetailResponseSchema.parse({ data: test, error: null }));
  }),
);

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
