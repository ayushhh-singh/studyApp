import { Router } from "express";
import { z } from "zod";
import {
  difficultySchema,
  examCodeSchema,
  papersResponseSchema,
  paperTreeResponseSchema,
  paperTrendsQuerySchema,
  paperTrendsResponseSchema,
  syllabusNodeDetailResponseSchema,
  syllabusTreeQuerySchema,
  syllabusTreeResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { getUserExam } from "../lib/exams.js";
import {
  getNodeDetail,
  getPaperSummaries,
  getPaperTree,
  getPaperTrends,
  getSyllabusTree,
} from "../services/syllabus.js";

const examFilterQuerySchema = z.object({ exam: examCodeSchema.optional() });

export const syllabusRouter = Router();
syllabusRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

syllabusRouter.get(
  "/syllabus/tree",
  asyncHandler(async (req, res) => {
    const query = parse(syllabusTreeQuerySchema, req.query);
    // Scoped to the caller's own exam — the tree feeds the command palette, so
    // an unscoped read would surface another exam's topics in their search.
    const tree = await getSyllabusTree(await getUserExam(currentUserId()), query.stage);
    res.json(syllabusTreeResponseSchema.parse({ data: tree, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/papers",
  asyncHandler(async (_req, res) => {
    const userId = currentUserId();
    const papers = await getPaperSummaries(userId, await getUserExam(userId));
    res.json(papersResponseSchema.parse({ data: papers, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/papers/:code/tree",
  asyncHandler(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(1) }), req.params);
    const { exam } = parse(examFilterQuerySchema, req.query);
    const { difficulty } = parse(z.object({ difficulty: difficultySchema.optional() }), req.query);
    const tree = await getPaperTree(currentUserId(), code, exam, difficulty);
    res.json(paperTreeResponseSchema.parse({ data: tree, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/papers/:code/trends",
  asyncHandler(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(1) }), req.params);
    const { exam } = parse(paperTrendsQuerySchema, req.query);
    const trends = await getPaperTrends(code, exam);
    res.json(paperTrendsResponseSchema.parse({ data: trends, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/nodes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { exam } = parse(examFilterQuerySchema, req.query);
    const node = await getNodeDetail(currentUserId(), id, exam);
    res.json(syllabusNodeDetailResponseSchema.parse({ data: node, error: null }));
  }),
);
