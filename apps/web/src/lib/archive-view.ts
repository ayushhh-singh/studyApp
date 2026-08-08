import { useSearchParams } from "react-router";

/**
 * The "recent list vs full archive" view state, shared by every surface that
 * uses `ui-x/recent-then-archive.tsx`.
 *
 * THE CONVENTION, stated once here so it cannot drift: a surface owns one
 * search param, which is set to `EXPANDED_VALUE` while the archive is showing
 * and REMOVED when it is not. Absent means recent, so the default view leaves
 * no param behind and URLs stay clean.
 *
 * This lives in `lib/` rather than beside the component because two different
 * things need it — the shell that renders the toggle, and any page that must
 * also know (to pick which filters to feed its own query, or whether to fire it
 * at all, as the PYQ archive does). Exporting a hook from the component file
 * would work but trips `react(only-export-components)`, and a page importing
 * its query gate from a UI component is the wrong dependency direction anyway.
 */
const EXPANDED_VALUE = "all";

export function useArchiveExpanded(param: string): boolean {
  const [searchParams] = useSearchParams();
  return searchParams.get(param) === EXPANDED_VALUE;
}

/**
 * Params that describe a POSITION IN, or a FILTER OVER, one of the two views.
 * Cleared whenever the view changes — see below for why that must happen in
 * BOTH directions.
 */
const VIEW_SCOPED_PARAMS = ["page", "year"];

/**
 * Applies the toggle to a param set. Exported alongside the reader so the two
 * halves of the convention cannot disagree about the sentinel value.
 *
 * ── CLEARS IN BOTH DIRECTIONS, AND THE EXPAND DIRECTION IS THE LOAD-BEARING
 * ── ONE. The recent view and the archive are DIFFERENT LISTS, so a page number
 * carried across describes a position in a list the user is no longer looking
 * at. Concretely, on the PYQ archive: page 3 of "the latest year" became page 3
 * of "every year" on expand — a silent jump into the middle of unrelated
 * content, and for a short year, a page past the end. Clearing only on collapse
 * (the first cut here) left exactly that hole.
 *
 * Filters are cleared for the mirror reason: they are meaningless in the recent
 * view and would silently re-apply on the next expand, dropping the student
 * back into a filtered list they had already left.
 *
 * A shared/bookmarked URL is unaffected — this runs only on a toggle CLICK, so
 * `?view=all&year=2019&page=2` still opens exactly where it says.
 */
export function applyArchiveExpanded(params: URLSearchParams, param: string, expanded: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  if (expanded) next.set(param, EXPANDED_VALUE);
  else next.delete(param);
  for (const p of VIEW_SCOPED_PARAMS) next.delete(p);
  return next;
}
