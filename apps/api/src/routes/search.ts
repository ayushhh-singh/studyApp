import { Router } from "express";
import { searchQuerySchema, searchResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { getUserExam } from "../lib/exams.js";
import { search } from "../services/search.js";

/**
 * Central search — the command palette's one query across every content type.
 *
 * The exam is resolved SERVER-side from the caller's profile and is never a
 * request parameter: a client-supplied exam would be a trivially-flipped way to
 * read another exam's whole corpus, and `getUserExam` additionally corrects a
 * row parked on a non-live exam (U7).
 */
export const searchRouter = Router();

// 120/min matches the other read routers (syllabus, questions). Search fires
// once per debounce pause rather than per keystroke, so sustained typing costs
// far fewer requests than this ceiling.
searchRouter.use(rateLimit({ windowMs: 60_000, max: 120 }));

searchRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { q, locale } = parse(searchQuerySchema, req.query);
    const userId = currentUserId();
    const result = await search(userId, await getUserExam(userId), q, locale);
    res.json(searchResponseSchema.parse({ data: result, error: null }));
  }),
);
