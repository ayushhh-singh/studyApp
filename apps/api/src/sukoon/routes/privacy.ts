/**
 * Sukoon F12 — Privacy Center API. Mounted under /api/sukoon (see routes/index.ts).
 * Deliberately does NOT apply requireActiveSukoonAccount: a deactivated account
 * must still reach these routes to view its state, EXPORT its data, and RESTORE
 * itself during the grace window.
 *
 * DELETE here is SUKOON-SCOPE (integrated mode): it soft-deletes sukoon_ data
 * only, never the auth user / Neev data. Standalone mode additionally erases the
 * auth user at hard-purge time (scripts/sukoon-purge.ts).
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonPrivacySummaryResponseSchema,
  sukoonExportJobResponseSchema,
  sukoonExportDownloadResponseSchema,
  sukoonAccountStateResponseSchema,
  sukoonDeleteAccountBodySchema,
  sukoonExportArtifactSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getPrivacySummary, scheduleDeletion, cancelDeletion } from "../services/privacy.js";
import { requestExport, getLatestExportJob, getExportJob, getExportDownloadUrl } from "../services/export.js";

export const sukoonPrivacyRouter = Router();
sukoonPrivacyRouter.use(requireAuth);
sukoonPrivacyRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

sukoonPrivacyRouter.get(
  "/privacy/summary",
  asyncHandler(async (_req, res) => {
    const summary = await getPrivacySummary(currentUserId());
    res.json(sukoonPrivacySummaryResponseSchema.parse({ data: summary, error: null }));
  }),
);

// --- Data export (async job → signed download) ---------------------------

// Building a full bundle is real work; keep the request rate low.
sukoonPrivacyRouter.post(
  "/privacy/export",
  rateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(async (_req, res) => {
    const job = await requestExport(currentUserId());
    res.json(sukoonExportJobResponseSchema.parse({ data: job, error: null }));
  }),
);

sukoonPrivacyRouter.get(
  "/privacy/export",
  asyncHandler(async (_req, res) => {
    const job = await getLatestExportJob(currentUserId());
    res.json(sukoonExportJobResponseSchema.parse({ data: job, error: null }));
  }),
);

const jobIdParamSchema = z.object({ id: z.string().uuid() });

sukoonPrivacyRouter.get(
  "/privacy/export/:id/download",
  asyncHandler(async (req, res) => {
    const { id } = parse(jobIdParamSchema, req.params);
    const artifact = parse(sukoonExportArtifactSchema, req.query.artifact ?? "json");
    const link = await getExportDownloadUrl(currentUserId(), id, artifact);
    res.json(sukoonExportDownloadResponseSchema.parse({ data: link, error: null }));
  }),
);

// Job-status poll for a specific job id (the client uses the latest-job GET
// above for the card, and this to poll a just-created job to "ready").
sukoonPrivacyRouter.get(
  "/privacy/export/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(jobIdParamSchema, req.params);
    const job = await getExportJob(currentUserId(), id);
    res.json(sukoonExportJobResponseSchema.parse({ data: job, error: null }));
  }),
);

// --- Account deletion lifecycle ------------------------------------------

const deleteLimiter = rateLimit({ windowMs: 60_000, max: 10 });

sukoonPrivacyRouter.post(
  "/privacy/delete",
  deleteLimiter,
  asyncHandler(async (req, res) => {
    parse(sukoonDeleteAccountBodySchema, req.body);
    const state = await scheduleDeletion(currentUserId(), "user_request");
    res.json(sukoonAccountStateResponseSchema.parse({ data: state, error: null }));
  }),
);

sukoonPrivacyRouter.post(
  "/privacy/delete/cancel",
  deleteLimiter,
  asyncHandler(async (_req, res) => {
    const state = await cancelDeletion(currentUserId());
    res.json(sukoonAccountStateResponseSchema.parse({ data: state, error: null }));
  }),
);

// Consent withdrawal = the same deactivation flow, flagged with its own reason
// (blueprint F12: "withdraw consent → deactivates account").
sukoonPrivacyRouter.post(
  "/privacy/consent/withdraw",
  deleteLimiter,
  asyncHandler(async (req, res) => {
    parse(sukoonDeleteAccountBodySchema, req.body);
    const state = await scheduleDeletion(currentUserId(), "consent_withdrawn");
    res.json(sukoonAccountStateResponseSchema.parse({ data: state, error: null }));
  }),
);
