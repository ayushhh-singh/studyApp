import { Router } from "express";
import { examsResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { rateLimit } from "../lib/rate-limit.js";
import { listExamsDetailed } from "../lib/exams.js";

// ---------------------------------------------------------------------------
// Public exam registry (mounted BEFORE requireAuth).
//
// WHY PUBLIC — the same test `/billing/plans` passes: every field is DB
// reference data about the PRODUCT, and not one byte of it depends on who is
// asking. There is no user id in the query, no per-user branch in the handler,
// and nothing here that a signed-out visitor could learn that the marketing
// pages don't already say out loud.
//
// It also has to be public to do its job. `launch_scope_i18n` is documented as
// the honest coverage statement shown BEFORE a user commits to an exam, and the
// surfaces where that matters — an exam picker on the auth/onboarding path, a
// "which exams do you cover?" answer on a public page — run with no session or
// with a guest one. Mounting it behind requireAuth would mean either duplicating
// the copy in the bundle (the hardcoding this slice exists to remove) or making
// the first exam-aware paint wait on a session.
//
// The DB already agrees: `exams` is readable by the anon key under 0053's
// content-table policy, and writes have no policy at all (service role only).
// This route is a read of a table the browser could technically read directly.
// ---------------------------------------------------------------------------
export const examsPublicRouter = Router();
examsPublicRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

/**
 * Every registered exam, live or not, in display order.
 *
 * The client uses this for exam-pattern facts it must never hardcode — paper
 * marks, qualifying thresholds and their `minimum.role`, paper ordering and
 * names — plus the display name interpolated into in-app copy.
 */
examsPublicRouter.get(
  "/exams",
  asyncHandler(async (_req, res) => {
    const exams = await listExamsDetailed();
    res.json(examsResponseSchema.parse({ data: exams, error: null }));
  }),
);
