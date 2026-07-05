import { Router } from "express";
import {
  createSrsCardFromCurrentAffairsFactBodySchema,
  createSrsCardFromEvaluationBodySchema,
  createSrsCardFromNodeBodySchema,
  createSrsCardFromQuestionBodySchema,
  srsCardResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import {
  addCurrentAffairsFactToRevision,
  addEvaluationToRevision,
  addNodeToRevision,
  addQuestionToRevision,
} from "../services/srs.js";

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

srsRouter.post(
  "/srs/cards/from-evaluation",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromEvaluationBodySchema, req.body);
    const card = await addEvaluationToRevision(devUserId(), body.submission_id);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);

srsRouter.post(
  "/srs/cards/from-current-affairs-fact",
  asyncHandler(async (req, res) => {
    const body = parse(createSrsCardFromCurrentAffairsFactBodySchema, req.body);
    const card = await addCurrentAffairsFactToRevision(devUserId(), body.item_id, body.fact_index);
    res.status(201).json(srsCardResponseSchema.parse({ data: card, error: null }));
  }),
);
