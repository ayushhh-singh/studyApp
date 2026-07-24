/**
 * Sukoon F4 — Journaling routes, mounted under /api/sukoon (see routes/index.ts).
 * Owner-scoped by currentUserId(); bodies are encrypted at rest and only cross
 * the wire decrypted on the single-entry + export paths. The reflection endpoint
 * is SSE (blueprint: AI responses stream) with pre-flight validation so 4xx
 * surface as JSON before the stream opens.
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonJournalCreateBodySchema,
  sukoonJournalUpdateBodySchema,
  sukoonJournalListQuerySchema,
  sukoonJournalListResponseSchema,
  sukoonJournalEntryResponseSchema,
  sukoonJournalDeleteResponseSchema,
  sukoonJournalPromptsResponseSchema,
  sukoonJournalHeatmapResponseSchema,
  sukoonJournalStreakSchema,
  sukoonReflectionUsageResponseSchema,
  sukoonJournalExportResponseSchema,
  sukoonPromptCategorySchema,
  sukoonExamPhaseSchema,
  apiEnvelopeSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { createSseConnection } from "../../lib/sse.js";
import {
  createEntry,
  updateEntry,
  deleteEntry,
  getEntry,
  listEntries,
  heatmap,
  streak,
  listPrompts,
  exportRange,
} from "../services/journal.js";
import { getReflectionUsage } from "../services/entitlements.js";
import { planReflection, executeReflection } from "../services/reflection.js";

export const sukoonJournalRouter = Router();
sukoonJournalRouter.use(requireAuth);
// Journal traffic is modest and per-user; a wide window keeps a normal editing
// session (autosave, tag edits) comfortably under the cap.
sukoonJournalRouter.use(rateLimit({ windowMs: 60_000, max: 90 }));

const monthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"),
});
const promptsQuerySchema = z.object({
  category: sukoonPromptCategorySchema.optional(),
  exam_phase: sukoonExamPhaseSchema.optional(),
});
const exportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((d) => d.from <= d.to, { message: "`from` must be on or before `to`" });
const idParamSchema = z.object({ id: z.string().uuid() });
const streakResponseSchema = apiEnvelopeSchema(z.object({ streak: sukoonJournalStreakSchema }));

// --- List / search (metadata only) -----------------------------------------
sukoonJournalRouter.get(
  "/journal",
  asyncHandler(async (req, res) => {
    const q = parse(sukoonJournalListQuerySchema, req.query);
    const result = await listEntries(currentUserId(), q);
    res.json(sukoonJournalListResponseSchema.parse({ data: result, error: null }));
  }),
);

// --- Guided prompts ---------------------------------------------------------
sukoonJournalRouter.get(
  "/journal/prompts",
  asyncHandler(async (req, res) => {
    const q = parse(promptsQuerySchema, req.query);
    const prompts = await listPrompts(q);
    res.json(sukoonJournalPromptsResponseSchema.parse({ data: { prompts }, error: null }));
  }),
);

// --- Calendar heatmap -------------------------------------------------------
sukoonJournalRouter.get(
  "/journal/heatmap",
  asyncHandler(async (req, res) => {
    const { month } = parse(monthSchema, req.query);
    const days = await heatmap(currentUserId(), month);
    res.json(sukoonJournalHeatmapResponseSchema.parse({ data: { month, days }, error: null }));
  }),
);

// --- Streak (gentle self-care days) -----------------------------------------
sukoonJournalRouter.get(
  "/journal/streak",
  asyncHandler(async (_req, res) => {
    const s = await streak(currentUserId());
    res.json(streakResponseSchema.parse({ data: { streak: s }, error: null }));
  }),
);

// --- Reflection allowance meter ---------------------------------------------
sukoonJournalRouter.get(
  "/journal/reflection/usage",
  asyncHandler(async (_req, res) => {
    const usage = await getReflectionUsage(currentUserId());
    res.json(sukoonReflectionUsageResponseSchema.parse({ data: usage, error: null }));
  }),
);

// --- Export a date range (decrypted, for print-to-PDF) ----------------------
sukoonJournalRouter.get(
  "/journal/export",
  asyncHandler(async (req, res) => {
    const { from, to } = parse(exportQuerySchema, req.query);
    const entries = await exportRange(currentUserId(), from, to);
    res.json(sukoonJournalExportResponseSchema.parse({ data: { from, to, entries }, error: null }));
  }),
);

// --- Create -----------------------------------------------------------------
sukoonJournalRouter.post(
  "/journal/entries",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonJournalCreateBodySchema, req.body);
    const entry = await createEntry(currentUserId(), body);
    res.status(201).json(sukoonJournalEntryResponseSchema.parse({ data: { entry }, error: null }));
  }),
);

// --- Read one (decrypted) ---------------------------------------------------
sukoonJournalRouter.get(
  "/journal/entries/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const entry = await getEntry(currentUserId(), id);
    res.json(sukoonJournalEntryResponseSchema.parse({ data: { entry }, error: null }));
  }),
);

// --- Update -----------------------------------------------------------------
sukoonJournalRouter.patch(
  "/journal/entries/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(sukoonJournalUpdateBodySchema, req.body);
    const entry = await updateEntry(currentUserId(), id, body);
    res.json(sukoonJournalEntryResponseSchema.parse({ data: { entry }, error: null }));
  }),
);

// --- Delete (soft) ----------------------------------------------------------
sukoonJournalRouter.delete(
  "/journal/entries/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    await deleteEntry(currentUserId(), id);
    res.json(sukoonJournalDeleteResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);

// --- Reflect (SSE) — the on-request AI reflection ---------------------------
sukoonJournalRouter.post(
  "/journal/entries/:id/reflect",
  rateLimit({ windowMs: 60_000, max: 15 }),
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const userId = currentUserId();
    // Pre-flight (existence, has-body, allowance) BEFORE opening the stream so
    // 4xx come back as JSON, not mid-SSE.
    const plan = await planReflection(userId, id);

    const { send, close } = createSseConnection(req, res);
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded) send(event, data);
    };
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    try {
      await executeReflection(userId, plan, emit, abort.signal);
      emit("done", { entry_id: id });
    } catch (err) {
      emit("error", { message: err instanceof Error ? err.message : "reflection failed" });
    } finally {
      close();
    }
  }),
);
