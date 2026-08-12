import { z } from "zod";
import { apiEnvelopeSchema, localeSchema } from "./types";

/**
 * CENTRAL SEARCH — the command palette's server-side query across every kind of
 * content a user can reach.
 *
 * ⚑ EVERY RESULT TYPE IS EXAM-SCOPED, and each one is scoped by a DIFFERENT
 * mechanism because each table carries its exam differently. That asymmetry is
 * the whole risk here — this app has repeatedly shipped a read that looked
 * scoped and was not (`listQuestions` returned a mixed page of 11 UPSC + 9
 * UPPSC rows; `getTodaysQuestion` served a UPSC question to a UPPSC user on
 * ~40% of days; the CA feed's `exam_codes` column was written by the pipeline
 * and read by nobody for weeks). Search is the worst possible place to repeat
 * it: it is the one surface that queries EVERY table at once, so a single
 * unscoped searcher leaks a second exam's content into a box the user typed a
 * completely innocent word into. See `apps/api/src/services/search.ts`, where
 * each searcher names its own mechanism, and the live both-directions
 * verification that backs it.
 */

/**
 * The kinds of content search covers. Adding a member here is deliberately a
 * COMPILE ERROR until a searcher exists for it (the server's registry is a
 * `Record<SearchResultType, Searcher>`), so a new content type cannot be
 * half-added and silently return nothing.
 */
export const searchResultTypeSchema = z.enum(["syllabus", "question", "chapter"]);
export type SearchResultType = z.infer<typeof searchResultTypeSchema>;

/**
 * Display order of the groups in the palette. Broadest-and-most-navigational
 * first (a syllabus topic is a place to GO), personal material next (your own
 * notes are the highest-signal thing you can be looking for once you have any),
 * then the long-tail corpora. Server-side so the client renders whatever order
 * the server sends rather than keeping a second copy that can drift.
 */
export const SEARCH_TYPE_ORDER: SearchResultType[] = ["syllabus", "chapter", "question"];

export const searchResultSchema = z.object({
  type: searchResultTypeSchema,
  id: z.string(),
  /**
   * Display title, ALREADY RESOLVED to the requested locale by the server
   * (falling back to the other locale when this one is empty — a chapter or a
   * PYQ can legitimately be one-sided). The client never sees `*_i18n` here:
   * search matches BOTH locales regardless of UI language, so a raw bilingual
   * object would leave the client guessing which side actually matched.
   */
  title: z.string(),
  /** One line of context — paper code, year, date, owning topic. */
  subtitle: z.string().nullable(),
  /**
   * Locale-RELATIVE destination, exactly like `nav.ts`'s `to` — the client
   * prefixes `/${locale}/`. Keeping the locale out of it means a result stays
   * correct if the user switches language with the palette open.
   */
  to: z.string(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchGroupSchema = z.object({
  type: searchResultTypeSchema,
  results: z.array(searchResultSchema),
  /**
   * True when this type had MORE matches than were returned. The palette says
   * so rather than silently truncating: "3 of many" and "3" mean different
   * things to someone deciding whether to refine their query.
   */
  has_more: z.boolean(),
});
export type SearchGroup = z.infer<typeof searchGroupSchema>;

export const searchResponseSchema = apiEnvelopeSchema(
  z.object({
    /** Echoed back so a late response can be matched to the query that asked for it. */
    query: z.string(),
    /** Only NON-EMPTY groups, in `SEARCH_TYPE_ORDER`. */
    groups: z.array(searchGroupSchema),
    total: z.number().int().nonnegative(),
    /**
     * True when at least one content type failed to search and its results are
     * therefore MISSING from `groups`.
     *
     * One flaky table must not blank the whole palette, so a failed searcher is
     * dropped rather than thrown — but a silently short result set is precisely
     * the "rendered a failure as nothing" trap this codebase has shipped three
     * times (`query-error-state.tsx`'s own docstring counts them). The client
     * says so out loud instead of letting the user read "no chapters match" when
     * the truth is "chapters could not be searched".
     */
    degraded: z.boolean(),
  }),
);
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** The shortest query worth running. One character matches most of the bank. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_QUERY_LENGTH).max(120),
  locale: localeSchema.default("en"),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
