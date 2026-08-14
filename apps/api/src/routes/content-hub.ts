import { Router } from "express";
import { z } from "zod";
import { examCalendarResponseSchema, paperWeightageResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { rateLimit } from "../lib/rate-limit.js";
import { parse } from "../lib/validation.js";
import { getPaperWeightage, listExamCalendar } from "../services/content-hub.js";

// ---------------------------------------------------------------------------
// The PUBLIC content-hub read surface (mounted BEFORE requireAuth).
//
// WHY PUBLIC — the same test `/exams` and `/billing/plans` pass: every field is
// DB reference data about the EXAM, and not one byte of it depends on who is
// asking. No user id in either query, no per-user branch in either handler.
//
// It also HAS to be public to do its job. `docs/content-strategy.md` §5's rule
// is that an article states its dates and percentages by reading them rather
// than freezing them into an i18n string; the reader of a marketing article is
// signed out by definition. `lib/articles.ts`'s PUBLIC_DATA_SOURCES plus
// check:seo rule 11 refuse to publish an article bound to a source with no
// public endpoint, which is what forced this router to exist before the first
// article could ship rather than after someone noticed a blank figure.
//
// ⚑ RATE LIMIT IS PER-IP, and that is a real trade rather than a copy-paste.
// `lib/rate-limit.ts` keys by `currentUserId()` and falls back to `req.ip`
// outside an auth context — which is the ONLY path here. Real visitors behind a
// shared NAT (a hostel, a college, a CGNAT range — common for this audience)
// therefore share one bucket, exactly as they already do on `/exams` and
// `/billing/plans`. 60/min matches those two, and a hub page makes at most two
// of these calls per visit.
// ---------------------------------------------------------------------------
export const contentHubPublicRouter = Router();
contentHubPublicRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

/** Every dated exam milestone we hold, soonest first, for every exam. */
contentHubPublicRouter.get(
  "/content-hub/exam-calendar",
  asyncHandler(async (_req, res) => {
    const entries = await listExamCalendar();
    res.json(examCalendarResponseSchema.parse({ data: entries, error: null }));
  }),
);

/**
 * Real per-section weightage for one or more papers.
 *
 * ⚑ THE PAPER CODE IS UNTRUSTED INPUT and is bounded here rather than trusted.
 * `paper_code` is globally unique across exams (the §0 invariant every
 * paper_code-only read in this repo leans on), so a code identifies its exam by
 * itself and no exam filter is needed — but the LENGTH is bounded so a caller
 * cannot ask for the entire tree in one request, and each code is shape-checked
 * so a junk value returns an empty array instead of reaching the query.
 *
 * Reading another exam's paper is deliberately allowed: this is published
 * reference data about what a commission asked, the same "public reference"
 * stance `getNodeDetail`/`getPaperTree` already take (docs/multi-exam.md §0a),
 * and the whole point of slate item #9 is comparing the two exams side by side.
 */
const weightageQuery = z.object({
  papers: z
    .string()
    .min(1)
    .max(200)
    .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
    .refine((list) => list.length > 0 && list.length <= 12, "pass 1-12 comma-separated paper codes")
    .refine((list) => list.every((p) => /^[A-Z0-9_]+$/.test(p)), "paper codes are uppercase alphanumeric"),
});

contentHubPublicRouter.get(
  "/content-hub/weightage",
  asyncHandler(async (req, res) => {
    const { papers } = parse(weightageQuery, req.query);
    const weightage = await getPaperWeightage(papers);
    res.json(paperWeightageResponseSchema.parse({ data: weightage, error: null }));
  }),
);
