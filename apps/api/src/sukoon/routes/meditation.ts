import { Router } from "express";
import {
  sukoonMeditationContextResponseSchema,
  sukoonMeditationDetailResponseSchema,
  sukoonMeditationGenerateBodySchema,
  sukoonMeditationListResponseSchema,
  sukoonMeditationResponseSchema,
  sukoonMeditationUsageResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { HttpError } from "../../lib/http-error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireActiveSukoonAccount } from "../lib/require-active-account.js";
import { currentUserId } from "../../lib/user-context.js";
import { getMeditationUsage } from "../services/entitlements.js";
import {
  acquireMeditation,
  generateMeditation,
  getMeditationById,
  getMeditationContext,
  listMeditations,
  planMeditation,
  releaseMeditation,
} from "../services/meditation.js";

/**
 * Personalized guided meditations (extends F6). Mounted under /api/sukoon
 * (outside Neev's /api/v1 + global-requireAuth ordering, like every Sukoon
 * router), so it attaches requireAuth itself. Generation is a plain POST/JSON
 * endpoint (not SSE): like Voice Mode's turn, the "stream" is the audio PLAYBACK
 * experience on the client, not a token stream — the full script must exist
 * before the one-shot TTS render anyway, so there's no partial-reply UI to feed.
 */
export const sukoonMeditationRouter = Router();
sukoonMeditationRouter.use(requireAuth);
sukoonMeditationRouter.use(requireActiveSukoonAccount);

/** The setup screen's smart defaults (suggested focus + gentle theme label). */
sukoonMeditationRouter.get(
  "/meditation/context",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const ctx = await getMeditationContext(currentUserId());
    res.json(sukoonMeditationContextResponseSchema.parse({ data: ctx, error: null }));
  }),
);

/** The generation allowance meter (for the setup screen's "N left" copy). */
sukoonMeditationRouter.get(
  "/meditation/usage",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const usage = await getMeditationUsage(currentUserId());
    res.json(sukoonMeditationUsageResponseSchema.parse({ data: usage, error: null }));
  }),
);

/** Generate (or replay a cached) personalized meditation. */
sukoonMeditationRouter.post(
  "/meditation/generate",
  // Heavier than a chat message (an LLM call + a one-time TTS render), and a
  // person rarely needs several fresh meditations a minute — a low cap plus the
  // one-in-flight lock below keeps cost bounded.
  rateLimit({ windowMs: 60_000, max: 6 }),
  asyncHandler(async (req, res) => {
    const body = parse(sukoonMeditationGenerateBodySchema, req.body);
    const userId = currentUserId();

    // One in-flight generation per user (its own lock) — always released in the
    // finally so a disconnect/error/abort can't strand it.
    if (!acquireMeditation(userId)) {
      throw new HttpError(409, "Still preparing your last meditation — one moment.");
    }

    const abort = new AbortController();
    req.on("close", () => abort.abort());

    try {
      await planMeditation(userId); // onboarding gate (JSON error before any work)
      const result = await generateMeditation(userId, body, abort.signal);
      if (!res.writableEnded) {
        res.json(sukoonMeditationResponseSchema.parse({ data: result, error: null }));
      }
    } catch (err) {
      // A mid-generation disconnect surfaces as a plain abort from whichever
      // call was in flight — expected, not a real failure; nothing to respond to.
      if (abort.signal.aborted) return;
      throw err;
    } finally {
      releaseMeditation(userId);
    }
  }),
);

/** Recent meditations (a small "again" list). */
sukoonMeditationRouter.get(
  "/meditation",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const meditations = await listMeditations(currentUserId());
    res.json(sukoonMeditationListResponseSchema.parse({ data: { meditations }, error: null }));
  }),
);

/** Replay one meditation (re-signs a fresh audio URL, no regeneration). */
sukoonMeditationRouter.get(
  "/meditation/:id",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const meditation = await getMeditationById(currentUserId(), req.params.id);
    res.json(sukoonMeditationDetailResponseSchema.parse({ data: { meditation }, error: null }));
  }),
);
