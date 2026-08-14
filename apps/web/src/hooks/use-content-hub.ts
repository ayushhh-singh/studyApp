import { useQuery } from "@tanstack/react-query";
import { examCalendarResponseSchema, paperWeightageResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * The content hub's two public reads (`docs/content-strategy.md` §5).
 *
 * Both endpoints are mounted BEFORE `requireAuth`, which is the whole reason
 * they exist: an article's reader is signed out by definition, so a date or a
 * percentage read from a source behind auth would render as a failed fetch in
 * exactly the place the headline figure belongs. `check:seo` rule 11 refuses to
 * publish an article bound to a non-public source, so this pairing is enforced
 * rather than remembered.
 *
 * ⚑ AND WHAT THIS DOES *NOT* FIX, stated once here so nobody re-discovers it:
 * `scripts/prerender.mjs` serves `dist/` off a static server with NO API behind
 * it, so a prerendered snapshot carries the loading state, never the data
 * (§9.4). A non-JS crawler sees the surrounding prose, not these tables. That is
 * an accepted consequence of the one-time-push decision — which is why an
 * article's substance lives in its prose and these blocks carry the numbers a
 * real reader wants current.
 */

/** 24h, matching `useExams`: reference data that changes by migration, not by the hour. */
const REFERENCE_STALE_TIME = 24 * 60 * 60_000;

export function useExamCalendar() {
  return useQuery({
    queryKey: queryKeys.examCalendar(),
    queryFn: () => api.get("/api/v1/content-hub/exam-calendar", examCalendarResponseSchema),
    staleTime: REFERENCE_STALE_TIME,
  });
}

/**
 * Per-section weightage for one or more papers.
 *
 * The key sorts the paper list, so `["A","B"]` and `["B","A"]` share one cache
 * entry rather than paying for the same rows twice.
 */
export function usePaperWeightage(papers: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.paperWeightage(papers),
    queryFn: () =>
      api.get("/api/v1/content-hub/weightage", paperWeightageResponseSchema, { papers: papers.join(",") }),
    staleTime: REFERENCE_STALE_TIME,
    enabled: papers.length > 0,
  });
}
