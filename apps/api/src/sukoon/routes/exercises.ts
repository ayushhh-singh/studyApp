/**
 * Sukoon F6 — Exercise library routes, mounted under /api/sukoon (see
 * routes/index.ts). Owner-scoped by currentUserId().
 */
import { Router } from "express";
import { z } from "zod";
import {
  sukoonExercisesResponseSchema,
  sukoonAudioUrlResponseSchema,
  sukoonExerciseAudioLangSchema,
  sukoonExerciseSessionStartBodySchema,
  sukoonExerciseSessionCompleteBodySchema,
  sukoonExerciseSessionResponseSchema,
  sukoonAmbientIdSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import {
  listExercises,
  getExerciseAudioUrl,
  getAmbientAudioUrl,
  startSession,
  completeSession,
} from "../services/exercises.js";

export const sukoonExercisesRouter = Router();
sukoonExercisesRouter.use(requireAuth);
// Browsing the grid + toggling ambient sounds re-mints signed URLs often —
// a wider window than the 10-second mood check-in, well under abuse territory.
sukoonExercisesRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

const idParamSchema = z.object({ id: z.string().uuid() });
const ambientIdParamSchema = z.object({ id: sukoonAmbientIdSchema });
const audioLangQuerySchema = z.object({ lang: sukoonExerciseAudioLangSchema });

// --- Catalog ------------------------------------------------------------------
sukoonExercisesRouter.get(
  "/exercises",
  asyncHandler(async (_req, res) => {
    const exercises = await listExercises(currentUserId());
    res.json(sukoonExercisesResponseSchema.parse({ data: { exercises }, error: null }));
  }),
);

// --- Ambient mixer signed URL (fixed catalog, always free) — kept ABOVE the
// :id route below so "ambient" is never captured as a uuid param. -----------
sukoonExercisesRouter.get(
  "/exercises/ambient/:id/audio-url",
  asyncHandler(async (req, res) => {
    const { id } = parse(ambientIdParamSchema, req.params);
    const signed = await getAmbientAudioUrl(id);
    res.json(sukoonAudioUrlResponseSchema.parse({ data: signed, error: null }));
  }),
);

// --- Exercise audio signed URL (premium-gated server-side) -------------------
sukoonExercisesRouter.get(
  "/exercises/:id/audio-url",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const { lang } = parse(audioLangQuerySchema, req.query);
    const signed = await getExerciseAudioUrl(currentUserId(), id, lang);
    res.json(sukoonAudioUrlResponseSchema.parse({ data: signed, error: null }));
  }),
);

// --- Session logging: start / complete ---------------------------------------
sukoonExercisesRouter.post(
  "/exercises/sessions",
  asyncHandler(async (req, res) => {
    const body = parse(sukoonExerciseSessionStartBodySchema, req.body);
    const session = await startSession(currentUserId(), body.exercise_id ?? null);
    res.status(201).json(sukoonExerciseSessionResponseSchema.parse({ data: { session }, error: null }));
  }),
);

sukoonExercisesRouter.patch(
  "/exercises/sessions/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(sukoonExerciseSessionCompleteBodySchema, req.body);
    const session = await completeSession(currentUserId(), id, body);
    res.json(sukoonExerciseSessionResponseSchema.parse({ data: { session }, error: null }));
  }),
);
