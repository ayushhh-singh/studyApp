import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Archive, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The "short recent list, then the full archive" shell shared by the three
 * surfaces that each need it (Practice → Daily, Practice → History, and the
 * PYQ archive's per-paper year view).
 *
 * WHAT IS SHARED IS THE SHELL, NOT THE ROWS. Each surface's rows are genuinely
 * different objects — a question card, a test card, an attempt row — so they
 * stay in their own components. What repeats across all three, and is therefore
 * what lives here, is: which of the two views is showing, how that survives a
 * reload/share, and the affordance between them.
 *
 * RECENT AND ARCHIVE ARE ALTERNATIVES, NOT STACKED. Expanding REPLACES the
 * recent list rather than appending below it — otherwise the newest rows render
 * twice on one screen (the latest year would appear both in "Latest" and at the
 * top of "all years"), which reads as a duplication bug.
 *
 * `archive` is only MOUNTED while expanded, so a collapsed surface never fires
 * the archive's own paginated query. Passing `<Foo/>` as a prop merely creates
 * the element; its hooks do not run until React mounts it.
 *
 * STATE LIVES IN THE URL, per the repo's routing convention that anything
 * shareable belongs in search params — so "here is the full archive, filtered
 * to 2023" is a link a student can send, and Back returns to the recent view
 * instead of leaving the page.
 */
export function RecentThenArchive({
  param,
  recent,
  archive,
  expandLabel,
  collapseLabel,
}: {
  /**
   * Search-param name owned by this surface, e.g. `view`. Set to `all` while
   * expanded and REMOVED when collapsed, so the collapsed (default) state
   * leaves no param behind and URLs stay clean.
   */
  param: string;
  recent: ReactNode;
  archive: ReactNode;
  /** Caller-owned so it can be specific ("See all 1,203 questions") — falls back to generic copy. */
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const expanded = searchParams.get(param) === "all";

  function toggle(next: boolean) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set(param, "all");
        else {
          params.delete(param);
          // The archive's own filters/page are meaningless in the recent view
          // and would silently re-apply on the next expand, so collapsing
          // clears them. `page` is shared with the archive by every current
          // caller; `year` is the PYQ archive's own filter.
          params.delete("page");
          params.delete("year");
        }
        return params;
      },
      // replace: paging between recent and archive is a view toggle, not a
      // navigation step — stacking it would make Back walk through toggles
      // instead of leaving the page.
      { replace: true },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {expanded ? archive : recent}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto sm:self-start"
        onClick={() => toggle(!expanded)}
      >
        {expanded ? (
          <>
            <ArrowLeft aria-hidden />
            {collapseLabel ?? t("Common.backToRecent")}
          </>
        ) : (
          <>
            <Archive aria-hidden />
            {expandLabel ?? t("Common.seeAll")}
          </>
        )}
      </Button>
    </div>
  );
}
