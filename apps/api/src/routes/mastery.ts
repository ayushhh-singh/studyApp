import { Router } from "express";
import { z } from "zod";
import { localeSchema, masteryMapResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getMasteryMap } from "../mastery/compute.js";
import { renderMasteryMapPng } from "../services/share-image.js";

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

/** Conquest Map share card (PNG) — the paper's territories coloured by mastery. */
masteryRouter.get(
  "/share/mastery.png",
  asyncHandler(async (req, res) => {
    const { paper, locale } = parse(
      z.object({ paper: z.string(), locale: localeSchema.default("en") }),
      req.query,
    );
    const map = await getMasteryMap(devUserId(), paper);
    const png = await renderMasteryMapPng(map, locale);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(png);
  }),
);
