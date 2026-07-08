import { Router } from "express";
import { eventBodySchema, eventResponseSchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { recordEvent } from "../services/events.js";

export const eventsRouter = Router();
eventsRouter.use(rateLimit({ windowMs: 60_000, max: 300 }));

eventsRouter.post(
  "/events",
  asyncHandler(async (req, res) => {
    const body = parse(eventBodySchema, req.body);
    const id = await recordEvent(currentUserId(), body);
    res.status(201).json(eventResponseSchema.parse({ data: { id }, error: null }));
  }),
);
