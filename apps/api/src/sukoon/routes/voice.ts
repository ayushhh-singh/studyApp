import { Router } from "express";
import { sukoonVoiceTurnBodySchema, sukoonVoiceTurnResponseSchema, sukoonVoiceUsageResponseSchema } from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { HttpError } from "../../lib/http-error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { getVoiceUsage } from "../services/entitlements.js";
import { acquireVoiceTurn, executeVoiceTurn, planVoiceTurn, releaseVoiceTurn } from "../services/voice.js";

/**
 * F10 Voice Mode. Mounted under /api/sukoon (outside Neev's /api/v1 +
 * global-requireAuth ordering, same as every other Sukoon router), so it
 * attaches requireAuth itself. `/voice/turn` is a plain POST/JSON endpoint
 * (see services/voice.ts's header for why this isn't SSE like /chat/stream) —
 * pre-flight validation (planVoiceTurn) runs before any audio work so a
 * 402/403/404 is a fast, cheap JSON error, never a wasted STT/TTS call.
 */
export const sukoonVoiceRouter = Router();
sukoonVoiceRouter.use(requireAuth);

sukoonVoiceRouter.get(
  "/voice/usage",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const usage = await getVoiceUsage(currentUserId());
    res.json(sukoonVoiceUsageResponseSchema.parse({ data: usage, error: null }));
  }),
);

sukoonVoiceRouter.post(
  "/voice/turn",
  // Lower than /chat/stream's 30/min — a voice turn is heavier (STT + an LLM
  // call + TTS, each a real external round trip) and a genuine push-to-talk
  // conversation rarely exceeds a handful of turns per minute.
  rateLimit({ windowMs: 60_000, max: 12 }),
  asyncHandler(async (req, res) => {
    const body = parse(sukoonVoiceTurnBodySchema, req.body);
    const userId = currentUserId();

    // One in-flight turn per user (its OWN lock, independent of text chat's —
    // see services/voice.ts). Always released in the finally so a disconnect/
    // error/abort can't strand it.
    if (!acquireVoiceTurn(userId)) {
      throw new HttpError(409, "Still processing your last message — one moment.");
    }

    const abort = new AbortController();
    req.on("close", () => abort.abort());

    try {
      const plan = await planVoiceTurn(userId, body.conversation_id ?? null);
      const result = await executeVoiceTurn(userId, plan, body, abort.signal);
      if (!res.writableEnded) {
        res.json(sukoonVoiceTurnResponseSchema.parse({ data: result, error: null }));
      }
    } catch (err) {
      // A mid-processing disconnect (the user closed the voice screen while
      // Saathi was still transcribing/thinking/speaking) surfaces as a plain
      // abort error from whichever call was in flight — expected, not a real
      // failure, so it must not hit the global error handler (which logs at
      // ERROR + reports to Sentry for anything without an HttpError status).
      // There's also no client left to respond to, so this simply returns.
      if (abort.signal.aborted) return;
      throw err;
    } finally {
      releaseVoiceTurn(userId);
    }
  }),
);
