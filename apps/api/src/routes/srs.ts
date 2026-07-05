import { Router } from "express";
import {
  createSrsCardFromNodeBodySchema,
  createSrsCardFromQuestionBodySchema,
  srsCardResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { addNodeToRevision, addQuestionToRevision } from "../services/srs.js";

export const srsRouter = Router();
srsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

srsRouter.post(
  "/srs/cards/from-node",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromNodeBodySchema, req.body);
    const card = await addNodeToRevision(devUserId(), body.node_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards/from-question",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromQuestionBodySchema, req.body);
    const card = await addQuestionToRevision(devUserId(), body.question_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);
