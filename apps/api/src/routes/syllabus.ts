import { Router } from "express";
import { syllabusTreeQuerySchema, syllabusTreeResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSyllabusTree } from "../services/syllabus.js";

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
