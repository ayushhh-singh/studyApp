import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpenCheck, ListChecks, Newspaper } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";
import { useMagazineMonths } from "@/hooks/use-magazine";

/**
 * Quick links into the most recently PUBLISHED month's two magazine editions.
 * Deliberately not the current calendar month — services/magazine.ts's
 * isMonthPublished gate means compilePrelimsEdition/compileMainsEdition
 * unconditionally return null for the still-running month (an issue only
 * publishes once its month has fully elapsed), so a card hardcoded to
 * istToday() would have been a guaranteed dead link on every load, for
 * every user, forever. useMagazineMonths() is the same exam-scoped,
 * already-curated list magazine-index.tsx renders, sorted most-recent-first,
 * so this card and the index page can never point at different "latest"
 * months. Self-hides (mirrors mentor-insight-card.tsx's `if (!x) return
 * null` convention) when nothing has published yet — before this app's
 * first full month of current-affairs content for a given exam, most
 * plausibly reachable when exam=UPSC. */
export function MagazineLinkCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useMagazineMonths();
  const latest = data?.[0];
  if (!latest) return null;
  const month = latest.month;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-muted-foreground" aria-hidden /> {t("Magazine.navTitle")}
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {/* A "published" month only needs content in ONE of the two editions
            (or a deep dive) to clear listMagazineMonths' filter — so the other
            edition can still be genuinely empty for this exact month. Guard
            each link on its own count rather than assuming both are populated
            together. */}
        {latest.prelims_item_count > 0 && (
          <Link
            to={`/${locale}/magazine/${month}/prelims`}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListChecks className="size-4 shrink-0 text-primary" aria-hidden />
            {t("Magazine.prelimsEditionTitle")}
          </Link>
        )}
        {(latest.mains_item_count > 0 || latest.deep_dive_count > 0) && (
          <Link
            to={`/${locale}/magazine/${month}/mains`}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-marigold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpenCheck className="size-4 shrink-0 text-marigold-foreground" aria-hidden />
            {t("Magazine.mainsEditionTitle")}
          </Link>
        )}
      </div>
    </SectionCard>
  );
}
