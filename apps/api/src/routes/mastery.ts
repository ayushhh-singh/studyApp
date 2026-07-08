import { Router } from "express";
import { z } from "zod";
import { masteryMapResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getMasteryMap } from "../mastery/compute.js";

export const masteryRouter = Router();
masteryRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

/** Conquest Map data: every node of a paper, annotated with mastery + PYQ weight. */
masteryRouter.get(
  "/mastery",
  asyncHandler(async (req, res) => {
    const { paper } = parse(z.object({ paper: z.string().optional() }), req.query);
    const map = await getMasteryMap(devUserId(), paper);
    res.json(masteryMapResponseSchema.parse({ data: map, error: null }));
  }),
);
