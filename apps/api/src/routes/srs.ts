import { Router } from "express";
import { createSrsCardFromNodeBodySchema, srsCardResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { addNodeToRevision } from "../services/srs.js";

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
