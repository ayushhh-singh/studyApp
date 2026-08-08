import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The prev / "page N of M" / next block, extracted from the three surfaces that
 * had each grown their own near-identical copy (pyq-archive.tsx,
 * practice/daily-quiz-panel.tsx, practice/attempt-history-list.tsx).
 *
 * ── COPY STAYS WITH THE CALLER. THIS IS NOT REDUNDANCY. ─────────────────────
 * The three sites do NOT share prev/next labels and must not be consolidated
 * onto one `Common.*` key, for two independent reasons:
 *
 *   SEMANTICS — a year-grouped question list pages through PAGES ("Previous" /
 *   "Next"), while a date-ordered archive pages through TIME ("Newer" /
 *   "Older"). Same control, different meaning.
 *
 *   HINDI GENDER AGREEMENT — the two time-ordered surfaces already differ from
 *   each other in Hindi: the daily archive reads नई / पुरानी (feminine,
 *   agreeing with क्विज़) and attempt history reads नए / पुराने (masculine
 *   plural, agreeing with प्रयास). Folding them onto one key would silently
 *   ship an agreement error in one of them — invisible to an English reader
 *   and to every typecheck.
 *
 * So this component owns LAYOUT, a11y and the disabled/guard logic; the caller
 * owns the words. `labels.pageOf` is interpolated with `{{page}}`/`{{total}}`.
 *
 * DELIBERATE VISUAL NORMALIZATION (not a pure lift-and-shift): all three sites
 * used `size="sm"` (h-8 = 32px), under the design system's 44px tap-target
 * floor — on a page whose primary audience is on a budget Android phone. They
 * also disagreed on `variant` (ghost vs outline) and on whether the buttons
 * carried chevrons at all. One look, at 44px, for all three.
 */
export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  labels,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  labels: { previous: string; next: string; pageOf: string };
  className?: string;
}) {
  const { t } = useTranslation();

  // Every caller previously guarded on this itself; owning it here deletes
  // three copies of the same condition.
  if (totalPages <= 1) return null;

  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <nav className={cn("flex items-center justify-between gap-2", className)} aria-label={t("Common.pagination")}>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={atStart}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeft aria-hidden />
        {labels.previous}
      </Button>
      {/* polite, not assertive: paging is user-initiated, so the new position
          should be announced after the list re-renders, never interrupt it. */}
      <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {labels.pageOf}
      </span>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={atEnd}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        {labels.next}
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
