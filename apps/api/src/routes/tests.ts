import { Router } from "express";
import { z } from "zod";
import {
  createCustomAnswerTestBodySchema,
  createCustomTestBodySchema,
  createFreshCustomSetBodySchema,
  createFreshMockSetBodySchema,
  freshSetResponseSchema,
  testDetailResponseSchema,
  testsListResponseSchema,
  testsQuerySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { createCustomAnswerTest, createCustomTestFromNode, getTestDetail, listTests } from "../services/tests.js";
import { createFreshCustomSet, createFreshMockSet } from "../services/on-demand.js";

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

// "Show me a new set" — a SELECTION against the demand-aware reserve, never a
// live generation call (see services/on-demand.ts). The per-user rate limit
// above is a second abuse layer on top of the DB's per-day demand dedup.
testsRouter.post(
  "/tests/fresh/custom",
  asyncHandler(async (req, res) => {
    const body = parse(createFreshCustomSetBodySchema, req.body);
    const result = await createFreshCustomSet(currentUserId(), body);
    res.status(result.status === "ready" ? 201 : 200).json(freshSetResponseSchema.parse({ data: result, error: null }));
  }),
);

testsRouter.post(
  "/tests/fresh/mock",
  asyncHandler(async (req, res) => {
    const body = parse(createFreshMockSetBodySchema, req.body);
    const result = await createFreshMockSet(currentUserId(), body);
    res.status(result.status === "ready" ? 201 : 200).json(freshSetResponseSchema.parse({ data: result, error: null }));
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
