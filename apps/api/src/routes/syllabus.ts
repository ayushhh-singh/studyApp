import { Router } from "express";
import { z } from "zod";
import {
  papersResponseSchema,
  paperTreeResponseSchema,
  syllabusNodeDetailResponseSchema,
  syllabusTreeQuerySchema,
  syllabusTreeResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getNodeDetail, getPaperSummaries, getPaperTree, getSyllabusTree } from "../services/syllabus.js";

export const syllabusRouter = Router();
syllabusRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

syllabusRouter.get(
  "/syllabus/tree",
  asyncHandler(async (req, res) => {
    const query = parse(syllabusTreeQuerySchema, req.query);
    const tree = await getSyllabusTree(query.stage);
    res.json(syllabusTreeResponseSchema.parse({ data: tree, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/papers",
  asyncHandler(async (_req, res) => {
    const papers = await getPaperSummaries(devUserId());
    res.json(papersResponseSchema.parse({ data: papers, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/papers/:code/tree",
  asyncHandler(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().min(1) }), req.params);
    const tree = await getPaperTree(devUserId(), code);
    res.json(paperTreeResponseSchema.parse({ data: tree, error: null }));
  }),
);

syllabusRouter.get(
  "/syllabus/nodes/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const node = await getNodeDetail(devUserId(), id);
    res.json(syllabusNodeDetailResponseSchema.parse({ data: node, error: null }));
  }),
);
