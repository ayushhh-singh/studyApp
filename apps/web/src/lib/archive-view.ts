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
 * Applies the toggle to a param set. Exported alongside the reader so the two
 * halves of the convention cannot disagree about the sentinel value.
 *
 * Collapsing also clears the archive's own filters: they are meaningless in the
 * recent view and would otherwise silently re-apply on the next expand,
 * dropping the student back into a filtered list they had left.
 */
export function applyArchiveExpanded(params: URLSearchParams, param: string, expanded: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  if (expanded) {
    next.set(param, EXPANDED_VALUE);
  } else {
    next.delete(param);
    // `page` is shared with the archive by every current caller; `year` is the
    // PYQ archive's own filter.
    next.delete("page");
    next.delete("year");
  }
  return next;
}
