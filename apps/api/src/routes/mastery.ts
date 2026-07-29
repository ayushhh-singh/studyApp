import { Router } from "express";
import { z } from "zod";
import { examCodeSchema, localeSchema, masteryMapResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { getUserExam } from "../lib/exams.js";
import { getMasteryMap } from "../mastery/compute.js";
import { renderMasteryMapPng } from "../services/share-image.js";

export const masteryRouter = Router();
masteryRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

/** Conquest Map data: every node of a paper, annotated with mastery + PYQ weight. */
masteryRouter.get(
  "/mastery",
  asyncHandler(async (req, res) => {
    const { paper, exam } = parse(z.object({ paper: z.string().optional(), exam: examCodeSchema.optional() }), req.query);
    // `exam` (query param) is the PROVENANCE filter on questions; the user's own
    // target exam is what scopes which syllabus tree the map is drawn from.
    const userId = currentUserId();
    const map = await getMasteryMap(userId, { paperCode: paper, exam, targetExam: await getUserExam(userId) });
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
    const userId = currentUserId();
    const map = await getMasteryMap(userId, { paperCode: paper, targetExam: await getUserExam(userId) });
    const png = await renderMasteryMapPng(map, locale);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(png);
  }),
);
