/**
 * Sukoon F7 — admin content-queue routes for Guided Journeys, mounted under
 * /api/sukoon (see routes/index.ts). "Reuse the Neev admin pattern" (session
 * brief) = reuse the SAME requireAdmin/is_admin gate Neev's own /admin/* uses
 * (apps/api/src/lib/admin.ts, backed by users_profile.is_admin — the same
 * Supabase project/auth Sukoon already shares) rather than inventing a second
 * admin concept; everything else (schema/services/routes) stays inside
 * apps/api/src/sukoon/ per the module's self-containment rule.
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonAdminStatusResponseSchema,
  sukoonJourneyAdminListResponseSchema,
  sukoonJourneyAdminDetailResponseSchema,
  sukoonJourneyValidateBodySchema,
  sukoonJourneyValidateResponseSchema,
  sukoonJourneyUpsertBodySchema,
  sukoonJourneyUpsertResponseSchema,
  sukoonJourneySlugSchema,
  sukoonCostSummaryResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireAdmin, isCurrentUserAdmin } from "../../lib/admin.js";
import {
  listAdminJourneys,
  getAdminJourneyDetail,
  validateJourneyContent,
  upsertJourneyContent,
  publishJourney,
  unpublishJourney,
} from "../services/journeys-admin.js";
import { getSukoonCostSummary } from "../services/cost.js";

export const sukoonAdminRouter = Router();
sukoonAdminRouter.use(requireAuth);

// Self-contained status probe (mirrors Neev's GET /admin/status) — the
// frontend's gate for whether to render the admin journeys queue page at all.
// Deliberately NOT behind requireAdmin itself: it exists to ANSWER "am I an
// admin", not to be denied to whoever's asking.
sukoonAdminRouter.get(
  "/admin/status",
  asyncHandler(async (_req, res) => {
    const is_admin = await isCurrentUserAdmin();
    res.json(sukoonAdminStatusResponseSchema.parse({ data: { is_admin }, error: null }));
  }),
);

sukoonAdminRouter.use("/admin/journeys", requireAdmin, rateLimit({ windowMs: 60_000, max: 120 }));

// Cost dashboard (Session 13 hardening) — per-model daily Sukoon spend from the
// shared llm_calls ledger. Admin-only, same gate as the journeys queue.
const costQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).optional().default(30),
});

sukoonAdminRouter.get(
  "/admin/cost",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const { days } = parse(costQuerySchema, req.query);
    const summary = await getSukoonCostSummary(days);
    res.json(sukoonCostSummaryResponseSchema.parse({ data: summary, error: null }));
  }),
);

const slugParamSchema = z.object({ slug: sukoonJourneySlugSchema });

sukoonAdminRouter.get(
  "/admin/journeys",
  asyncHandler(async (_req, res) => {
    const journeys = await listAdminJourneys();
    res.json(sukoonJourneyAdminListResponseSchema.parse({ data: { journeys }, error: null }));
  }),
);

sukoonAdminRouter.get(
  "/admin/journeys/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const result = await getAdminJourneyDetail(slug);
    res.json(sukoonJourneyAdminDetailResponseSchema.parse({ data: result, error: null }));
  }),
);

// Dry run — validates a pasted/uploaded document without writing anything, so
// the queue's preview step can show field-level issues before anyone commits.
sukoonAdminRouter.post(
  "/admin/journeys/validate",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonJourneyValidateBodySchema, req.body);
    const result = validateJourneyContent(body.content);
    res.json(sukoonJourneyValidateResponseSchema.parse({ data: result, error: null }));
  }),
);

// Upsert-by-slug: create, or replace an existing journey's content wholesale
// (bumps `version`). Never auto-publishes — see the two actions below.
sukoonAdminRouter.post(
  "/admin/journeys",
  asyncHandler(async (req, res) => {
    const content = parse(sukoonJourneyUpsertBodySchema, req.body);
    const journey = await upsertJourneyContent(content);
    res.status(201).json(sukoonJourneyUpsertResponseSchema.parse({ data: { journey }, error: null }));
  }),
);

sukoonAdminRouter.post(
  "/admin/journeys/:slug/publish",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const journey = await publishJourney(slug);
    res.json(sukoonJourneyUpsertResponseSchema.parse({ data: { journey }, error: null }));
  }),
);

sukoonAdminRouter.post(
  "/admin/journeys/:slug/unpublish",
  asyncHandler(async (req, res) => {
    const { slug } = parse(slugParamSchema, req.params);
    const journey = await unpublishJourney(slug);
    res.json(sukoonJourneyUpsertResponseSchema.parse({ data: { journey }, error: null }));
  }),
);
