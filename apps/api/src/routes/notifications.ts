import { Router } from "express";
import { z } from "zod";
import { notificationListResponseSchema, notificationResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { generateForUser, listActive, setStatus } from "../services/notifications.js";

export const notificationsRouter = Router();
notificationsRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

const idParams = z.object({ id: z.string().uuid() });

notificationsRouter.get(
  "/notifications",
  asyncHandler(async (_req, res) => {
    const userId = currentUserId();
    // Self-heal: (re)generate today's nudges and resolve stale ones before listing.
    await generateForUser(userId);
    const { items, unread_count } = await listActive(userId);
    res.json(notificationListResponseSchema.parse({ data: { items, unread_count }, error: null }));
  }),
);

notificationsRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const n = await setStatus(currentUserId(), id, "read");
    res.json(notificationResponseSchema.parse({ data: n, error: null }));
  }),
);

notificationsRouter.post(
  "/notifications/:id/dismiss",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParams, req.params);
    const n = await setStatus(currentUserId(), id, "dismissed");
    res.json(notificationResponseSchema.parse({ data: n, error: null }));
  }),
);
