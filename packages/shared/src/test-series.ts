import { z } from "zod";
import { bilingualTextSchema, examStageSchema } from "./types";

/**
 * Scheduled test series — the client-facing contract.
 * See docs/test-series-design.md §5 for the data model these mirror.
 */

/**
 * Per-entry state, DERIVED at read time from timestamps — there is no state
 * column, and adding one would be a bug: `locked` and `open` differ only by the
 * clock, so a stored value would need a job to keep it true (§5.5, §7.1).
 *
 *   locked          before opens_at — preponement is not allowed
 *   open            opened, not started
 *   in_progress     an unsubmitted attempt exists
 *   submitted       submitted within the ranked window
 *   submitted_late  submitted after ranked_until — counts for practice and for
 *                   the student's own analytics, but does not place on the board
 */
export const seriesEntryStateSchema = z.enum([
  /** On the calendar, paper not assembled yet — see build.ts's --window mode. */
  "scheduled",
  "locked",
  "open",
  "in_progress",
  "submitted",
  "submitted_late",
]);
export type SeriesEntryState = z.infer<typeof seriesEntryStateSchema>;

export const seriesEntryKindSchema = z.enum([
  "fundamental",
  "applied",
  "sectional",
  "full_length",
  "current_affairs",
  "state_special",
]);
export type SeriesEntryKind = z.infer<typeof seriesEntryKindSchema>;

export const testSeriesEntrySchema = z.object({
  id: z.string().uuid(),
  /** Null until the paper is assembled (the calendar is published first). */
  test_id: z.string().uuid().nullable(),
  sequence_no: z.number().int(),
  entry_kind: seriesEntryKindSchema,
  /** Null while unassembled — the entry's own syllabus note is the label then. */
  title_i18n: bilingualTextSchema.nullable(),
  paper_code: z.string().nullable(),
  duration_minutes: z.number().int().nullable(),
  total_marks: z.number().nullable(),
  question_count: z.number().int(),
  opens_at: z.string(),
  closes_at: z.string().nullable(),
  ranked_until: z.string().nullable(),
  /** The "Topics covered" column every real institute schedule publishes. */
  syllabus_note_i18n: bilingualTextSchema.nullable(),
  /** The "Sources covered" column — the calendar is a study plan, not just dates. */
  sources_i18n: bilingualTextSchema.nullable(),
  state: seriesEntryStateSchema,
  attempt_id: z.string().uuid().nullable(),
  score: z.number().nullable(),
  total: z.number().nullable(),
});
export type TestSeriesEntry = z.infer<typeof testSeriesEntrySchema>;

const seriesBase = {
  id: z.string().uuid(),
  slug: z.string(),
  exam_code: z.string(),
  stage: examStageSchema,
  paper_scope: z.string().nullable(),
  title_i18n: bilingualTextSchema,
  description_i18n: bilingualTextSchema.nullable(),
  status: z.enum(["draft", "published", "archived"]),
  starts_on: z.string(),
  ends_on: z.string(),
  target_exam_year: z.number().int().nullable(),
};

export const testSeriesSummarySchema = z.object({
  ...seriesBase,
  entry_count: z.number().int(),
  open_count: z.number().int(),
  completed_count: z.number().int(),
});
export type TestSeriesSummary = z.infer<typeof testSeriesSummarySchema>;

export const testSeriesDetailSchema = z.object({
  ...seriesBase,
  entries: z.array(testSeriesEntrySchema),
});
export type TestSeriesDetail = z.infer<typeof testSeriesDetailSchema>;

export const testSeriesListResponseSchema = z.object({ series: z.array(testSeriesSummarySchema) });

/**
 * A submitted attempt's series context, shown on the result page.
 *
 * `ranked` is the two-tier distinction the design's §2.4 window rule creates:
 * an attempt inside the window competes with the cohort, one after it is
 * informational. The page must say which, or a student compares a practice
 * score against a ranked cohort and draws the wrong conclusion.
 */
export const attemptSeriesContextSchema = z.object({
  series_slug: z.string(),
  series_title_i18n: bilingualTextSchema,
  sequence_no: z.number().int(),
  entry_count: z.number().int(),
  entry_kind: seriesEntryKindSchema,
  ranked: z.boolean(),
  ranked_until: z.string().nullable(),
  /** Rank within the ranked cohort, null when this attempt is not ranked. */
  rank: z.number().int().nullable(),
  cohort_size: z.number().int(),
});
export type AttemptSeriesContext = z.infer<typeof attemptSeriesContextSchema>;
