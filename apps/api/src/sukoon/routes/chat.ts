import { Router } from "express";
import { z } from "zod";
import {
  sukoonChatHistoryResponseSchema,
  sukoonChatStreamBodySchema,
  sukoonChatUsageResponseSchema,
  sukoonConversationsResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { HttpError } from "../../lib/http-error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireActiveSukoonAccount } from "../lib/require-active-account.js";
import { currentUserId } from "../../lib/user-context.js";
import { createSseConnection } from "../../lib/sse.js";
import { getChatUsage } from "../services/entitlements.js";
import { getSukoonChatHistory, listSukoonConversations } from "../services/history.js";
import {
  acquireChatStream,
  executeChatStream,
  planChatMessage,
  releaseChatStream,
  type SukoonChatEmit,
} from "../services/chat.js";

/**
 * Saathi chat (F2). Mounted under /api/sukoon (outside Neev's /api/v1 +
 * global-requireAuth ordering), so it attaches requireAuth itself. The SSE
 * stream endpoint runs pre-flight validation (planChatMessage) BEFORE opening
 * the stream so 404/403/400 surface as real JSON, then streams via the emitter.
 */
export const sukoonChatRouter = Router();
sukoonChatRouter.use(requireAuth);
sukoonChatRouter.use(requireActiveSukoonAccount);

const historyQuerySchema = z.object({ conversation_id: z.string().uuid().optional() });

sukoonChatRouter.get(
  "/chat/usage",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const usage = await getChatUsage(currentUserId());
    res.json(sukoonChatUsageResponseSchema.parse({ data: usage, error: null }));
  }),
);

sukoonChatRouter.get(
  "/chat/conversations",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (_req, res) => {
    const conversations = await listSukoonConversations(currentUserId());
    res.json(sukoonConversationsResponseSchema.parse({ data: { conversations }, error: null }));
  }),
);

sukoonChatRouter.get(
  "/chat/history",
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const { conversation_id } = parse(historyQuerySchema, req.query);
    const history = await getSukoonChatHistory(currentUserId(), conversation_id);
    res.json(sukoonChatHistoryResponseSchema.parse({ data: history, error: null }));
  }),
);

sukoonChatRouter.post(
  "/chat/stream",
  rateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const body = parse(sukoonChatStreamBodySchema, req.body);
    const userId = currentUserId();

    // One in-flight reply per user (defense in depth alongside the client's own
    // guard). 409 pre-flight if a stream is already running; ALWAYS released in
    // the finally so an abort/error/disconnect can't strand the lock.
    if (!acquireChatStream(userId)) {
      throw new HttpError(409, "A reply is already in progress — please wait a moment.");
    }

    try {
      // Pre-flight (JSON errors) before the SSE opens: onboarded? not restricted?
      // conversation validated.
      const plan = await planChatMessage(userId, body);

      const { send, close } = createSseConnection(req, res);
      const emit: SukoonChatEmit = (event, data) => {
        if (!res.writableEnded) send(event, data);
      };

      const abort = new AbortController();
      req.on("close", () => abort.abort());

      try {
        await executeChatStream(userId, plan, emit, abort.signal);
      } catch (err) {
        emit("error", { message: err instanceof Error ? err.message : "Saathi couldn't reply just now." });
      } finally {
        close();
      }
    } finally {
      releaseChatStream(userId);
    }
  }),
);
