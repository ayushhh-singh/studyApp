import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { ProgressBar } from "@/components/ui-x/progress-bar";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useTestSeriesList } from "@/hooks/use-test-series";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "TestSeries.title" };

/** Index of the scheduled series available to this user. */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const query = useTestSeriesList();

  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("TestSeries.title")} description={t("TestSeries.indexDescription")} />
        <QueryErrorState onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const series = query.data?.series ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("TestSeries.title")} description={t("TestSeries.indexDescription")} />

      {query.isPending ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="bg-muted h-32 w-full animate-pulse rounded-xl" />
          ))}
        </div>
      ) : series.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("TestSeries.noneTitle")}
          description={t("TestSeries.noneDescription")}
        />
      ) : (
        <ul className="space-y-3">
          {series.map((s) => (
            <li key={s.id}>
              <Link
                to={`/${locale}/test-series/${s.slug}`}
                className="bg-card border-border hover:border-primary/50 focus-visible:ring-ring block rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 flex-1 text-base font-semibold">{s.title_i18n[locale]}</h2>
                  {s.status === "draft" && (
                    <span className="bg-marigold/15 text-marigold-foreground shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                      {t("TestSeries.draft")}
                    </span>
                  )}
                </div>
                {s.description_i18n ? (
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.description_i18n[locale]}</p>
                ) : null}
                <div className="mt-3 space-y-2">
                  <ProgressBar
                    value={s.entry_count ? (s.completed_count / s.entry_count) * 100 : 0}
                    label={t("TestSeries.completedOf", { done: s.completed_count, total: s.entry_count })}
                    showValue={false}
                  />
                  <p className="text-muted-foreground text-xs">{t("TestSeries.openNow", { count: s.open_count })}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
