import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useTestSeriesList } from "@/hooks/use-test-series";
import { useLocale } from "@/hooks/use-locale";

/**
 * The link into the scheduled test series, on the Mock Tests tab.
 *
 * ⚑ RENDERS NOTHING WHEN THE USER HAS NO SERIES, and that is the point rather
 * than a fallback. Access is decided server-side (own live exam, published —
 * admins also see drafts), so today every non-admin correctly gets an empty
 * list. A permanent nav entry would send them to an empty page; a link that
 * appears only when there is something behind it does not.
 *
 * It also renders nothing on ERROR, deliberately: this is a secondary entry
 * point beside a working list of mocks, and an error box here would claim the
 * Practice page is broken when it is not. The series' own page reports its
 * failures properly.
 *
 * Note the counterpart trap: `/pyq-archive` lost its only entry point and
 * became reachable from nowhere in the product (docs/OUTSTANDING.md C5). This
 * is the one link in, so if the Mock tab is ever restructured, move it — do not
 * simply drop it.
 */
export function SeriesEntryPoint() {
  const { t } = useTranslation();
  const locale = useLocale();
  const query = useTestSeriesList();
  const series = query.data?.series ?? [];
  if (query.isPending || query.isError || series.length === 0) return null;

  return (
    <ul className="space-y-2">
      {series.map((s) => (
        <li key={s.id}>
          <Link
            to={`/${locale}/test-series/${s.slug}`}
            className="bg-card border-border hover:border-primary/50 focus-visible:ring-ring flex min-h-11 items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <CalendarDays className="text-primary h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.title_i18n[locale]}</span>
              <span className="text-muted-foreground block text-xs">
                {t("TestSeries.completedOf", { done: s.completed_count, total: s.entry_count })}
                {s.open_count > 0 ? ` · ${t("TestSeries.openNow", { count: s.open_count })}` : ""}
              </span>
            </span>
            <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
