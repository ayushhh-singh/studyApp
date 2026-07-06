import { Router } from "express";
import { z } from "zod";
import {
  magazineMonthSchema,
  magazineMonthsResponseSchema,
  magazineResponseSchema,
} from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { compileMagazine, listMagazineMonths } from "../services/magazine.js";

export const magazineRouter = Router();
magazineRouter.use("/magazine", rateLimit({ windowMs: 60_000, max: 120 }));

/** Months that have a compilable magazine (for the index/picker). */
magazineRouter.get(
  "/magazine",
  asyncHandler(async (_req, res) => {
    res.json(magazineMonthsResponseSchema.parse({ data: await listMagazineMonths(), error: null }));
  }),
);

const monthParams = z.object({ month: magazineMonthSchema });

/** The compiled monthly current-affairs magazine (null if the month has no published CA). */
magazineRouter.get(
  "/magazine/:month",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthParams, req.params);
    res.json(magazineResponseSchema.parse({ data: await compileMagazine(month), error: null }));
  }),
);
