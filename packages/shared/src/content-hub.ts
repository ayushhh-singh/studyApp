import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examStageSchema } from "./types";
import { targetExamCodeSchema } from "./exams";

/**
 * The PUBLIC read surface for the content hub (`docs/content-strategy.md` §5,
 * §6.4).
 *
 * ⚑ WHY THIS EXISTS AT ALL, AND WHY IT HAD TO BE PUBLIC. §5's core rule is
 * "don't hand-write a date that drifts stale" — an article states its numbers by
 * READING them, never by freezing them into an i18n string, because both message
 * files are large and shared and a number frozen in `hi.json` is a number nobody
 * will ever remember to update.
 *
 * But every source those articles need — `exam_calendar`, `mv_node_weightage` —
 * sat behind `requireAuth`. `lib/articles.ts` already encodes the consequence in
 * `PUBLIC_DATA_SOURCES`, and `check:seo` rule 11 REFUSES to publish an article
 * bound to a non-public source, precisely so this could not be discovered after
 * the fact: a signed-out reader is the entire audience for a marketing article,
 * and they would have got a failed fetch exactly where the headline figure
 * belongs. So publishing the exam-date and restructure pieces required exposing
 * these first. That is the order the guard enforces.
 *
 * These pass the same test `/exams` and `/billing/plans` pass: every field is DB
 * reference data about the EXAM, not about the person asking. There is no user
 * id in either query, no per-user branch in either handler, and nothing here a
 * signed-out visitor could learn that the commission has not already published.
 */

/**
 * One dated milestone from `exam_calendar`.
 *
 * `notes_i18n` carries the provenance line each seed migration wrote (0023,
 * 0126) — which notification the date came from and, where the commission says
 * so, that its calendar dates are liable to alteration. It is surfaced rather
 * than dropped because §5.2's whole point is that a page states its own
 * currency: a reader who can see the source is not depending on us to be fresh.
 */
export const examCalendarEntrySchema = z.object({
  exam_code: targetExamCodeSchema,
  exam_stage: examStageSchema,
  title_i18n: bilingualTextSchema,
  /** ISO `YYYY-MM-DD`. For a multi-day sitting this is the day it BEGINS (0126). */
  exam_date: z.string(),
  year: z.number().int(),
  /**
   * True only where the commission itself has not fixed the date. Never used to
   * hedge a real published date — 0126 records why both UPSC 2027 rows are
   * false despite the calendar's own boilerplate alteration clause.
   */
  is_tentative: z.boolean(),
  notes_i18n: bilingualTextSchema.nullable(),
});
export type ExamCalendarEntry = z.infer<typeof examCalendarEntrySchema>;

export const examCalendarResponseSchema = apiEnvelopeSchema(z.array(examCalendarEntrySchema));
export type ExamCalendarResponse = z.infer<typeof examCalendarResponseSchema>;

/** One depth-1 syllabus section's share of a paper, with its by-year series. */
export const weightageSectionSchema = z.object({
  node_id: z.string(),
  title_i18n: bilingualTextSchema,
  /** Questions asked in this section's whole subtree, across every year we hold. */
  total: z.number().int(),
  /** `{ "2023": 6, "2024": 8 }` — sparse; a year with none is simply absent. */
  by_year: z.record(z.string(), z.number().int()),
  /** Rounded to one decimal, server-side, so every surface quotes one number. */
  share_pct: z.number(),
});
export type WeightageSection = z.infer<typeof weightageSectionSchema>;

/**
 * A paper's real weightage, rolled from `mv_node_weightage` to depth-1 sections.
 *
 * ⚑ TWO PROPERTIES THAT MAKE THIS SAFE TO PUBLISH, both checked rather than
 * assumed (`docs/content-strategy.md` §2c):
 *
 *  - The matview is defined `where is_published and review_state='approved' and
 *    source='pyq'` (migration 0037), so AI-generated practice items are excluded
 *    BY CONSTRUCTION. These percentages describe what the commission asked, not
 *    what we produced — which is the one distinction §2a says must never blur.
 *  - `years` is the actual set of years with data, returned so a page can state
 *    its own coverage. It is NOT a completeness claim: UPPSC Prelims GS-I 2022
 *    is ingested but effectively unpublished (§2b), so a page quoting a per-year
 *    series owes the reader that gap next to the chart.
 */
export const paperWeightageSchema = z.object({
  paper_code: z.string(),
  exam_code: targetExamCodeSchema,
  /** Sum of every section's subtree count — the denominator behind `share_pct`. */
  total_questions: z.number().int(),
  /** Ascending, and only years that actually carry questions. */
  years: z.array(z.number().int()),
  /** Descending by `total`, so the biggest section reads first with no client sort. */
  sections: z.array(weightageSectionSchema),
});
export type PaperWeightage = z.infer<typeof paperWeightageSchema>;

export const paperWeightageResponseSchema = apiEnvelopeSchema(z.array(paperWeightageSchema));
export type PaperWeightageResponse = z.infer<typeof paperWeightageResponseSchema>;
