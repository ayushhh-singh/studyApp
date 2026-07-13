import { Router } from "express";
import {
  okResponseSchema,
  pushPreferencesResponseSchema,
  pushStatusResponseSchema,
  pushSubscribeBodySchema,
  pushUnsubscribeBodySchema,
  updatePushPreferencesBodySchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { vapidPublicKey } from "../lib/push.js";
import { getStatus, subscribe, unsubscribe, updatePreferences } from "../services/push.js";

export const pushRouter = Router();
pushRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

pushRouter.get(
  "/push/vapid-public-key",
  asyncHandler(async (_req, res) => {
    res.json({ data: { key: vapidPublicKey() }, error: null });
  }),
);

pushRouter.get(
  "/push/status",
  asyncHandler(async (_req, res) => {
    const status = await getStatus(currentUserId());
    res.json(pushStatusResponseSchema.parse({ data: status, error: null }));
  }),
);

pushRouter.post(
  "/push/subscribe",
  asyncHandler(async (req, res) => {
    const body = parse(pushSubscribeBodySchema, req.body);
    await subscribe(currentUserId(), body);
    res.json(okResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);

pushRouter.post(
  "/push/unsubscribe",
  asyncHandler(async (req, res) => {
    const body = parse(pushUnsubscribeBodySchema, req.body);
    await unsubscribe(currentUserId(), body.endpoint);
    res.json(okResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);

pushRouter.patch(
  "/push/preferences",
  asyncHandler(async (req, res) => {
    const body = parse(updatePushPreferencesBodySchema, req.body);
    const preferences = await updatePreferences(currentUserId(), body);
    res.json(pushPreferencesResponseSchema.parse({ data: preferences, error: null }));
  }),
);
