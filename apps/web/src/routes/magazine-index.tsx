import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Newspaper, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useMagazineMonths } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Magazine.navTitle" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading, isError, refetch } = useMagazineMonths();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Magazine.indexTitle")} description={t("Magazine.indexDescription")} />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Newspaper} title={t("Magazine.emptyTitle")} description={t("Magazine.emptyDescription")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((m) => (
            <li key={m.month}>
              <Link
                to={`/${locale}/magazine/${m.month}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-marigold/15 text-marigold-foreground">
                  <Newspaper className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{m.title_i18n[locale]}</span>
                  <span className="text-xs text-muted-foreground">{t("Magazine.itemCount", { count: m.item_count })}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
