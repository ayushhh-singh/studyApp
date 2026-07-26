import { Router } from "express";
import { z } from "zod";
import {
  magazineMonthSchema,
  magazineMonthsResponseSchema,
  magazineMainsResponseSchema,
  magazinePrelimsResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { touchFeatureOnRequest } from "../lib/feature-touch.js";
import { currentUserId } from "../lib/user-context.js";
import { assertMagazinePdf } from "../services/entitlements.js";
import { compileMainsEdition, compilePrelimsEdition, listMagazineMonths } from "../services/magazine.js";

export const magazineRouter = Router();
magazineRouter.use("/magazine", rateLimit({ windowMs: 60_000, max: 120 }));
magazineRouter.use("/magazine", touchFeatureOnRequest("magazine"));

/** Months that have a compilable magazine edition (for the index/picker). */
magazineRouter.get(
  "/magazine",
  asyncHandler(async (_req, res) => {
    res.json(magazineMonthsResponseSchema.parse({ data: await listMagazineMonths(), error: null }));
  }),
);

const monthParams = z.object({ month: magazineMonthSchema });

/** Prelims Compendium — boxed facts, topic-wise + by kind, plus the workbook appendix. */
magazineRouter.get(
  "/magazine/:month/prelims",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthParams, req.params);
    res.json(magazinePrelimsResponseSchema.parse({ data: await compilePrelimsEdition(month), error: null }));
  }),
);

/** Mains Analysis — GS-paper-wise issue briefs, published Deep Dives, Model Mains Questions. */
magazineRouter.get(
  "/magazine/:month/mains",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthParams, req.params);
    res.json(magazineMainsResponseSchema.parse({ data: await compileMainsEdition(month), error: null }));
  }),
);

// ---------------------------------------------------------------------------
// PDF export (Pro-only) — the AUTHORITATIVE gate for downloading a clean PDF.
// The web-view endpoints above stay free/ungated; these mirror them exactly but
// call assertMagazinePdf first. The client's print flow routes through these so
// the gate is server-enforced (a tampered-client isPro can't bypass it) — a 402
// with feature="magazine_pdf" is what the UI turns into the upgrade paywall.
// assertMagazinePdf re-reads the plan fresh per request (getPlanFor), so a
// lapsed Pro/trial is blocked on the very next export with no refresh.
// ---------------------------------------------------------------------------
magazineRouter.get(
  "/magazine/:month/prelims/export",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthParams, req.params);
    await assertMagazinePdf(currentUserId());
    res.json(magazinePrelimsResponseSchema.parse({ data: await compilePrelimsEdition(month), error: null }));
  }),
);

magazineRouter.get(
  "/magazine/:month/mains/export",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthParams, req.params);
    await assertMagazinePdf(currentUserId());
    res.json(magazineMainsResponseSchema.parse({ data: await compileMainsEdition(month), error: null }));
  }),
);
