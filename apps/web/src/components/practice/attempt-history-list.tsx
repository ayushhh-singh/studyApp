import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useAttempts } from "@/hooks/use-attempt";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";
import { formatScoreValue } from "@/lib/format-score";

export function AttemptHistoryList() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useAttempts(page);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (isError) return <QueryErrorState onRetry={() => refetch()} />;

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("Practice.historyEmptyTitle")}
        description={t("Practice.historyEmptyDescription")}
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {data.items.map((item) => {
          const pct = item.score !== null && item.total ? (item.score / item.total) * 100 : null;
          return (
            <li key={item.id}>
              <Link
                to={`/${locale}/practice/attempt/${item.id}/result`}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="line-clamp-2 text-sm" lang={locale}>
                  {item.test_title_i18n?.[locale] ?? t("Practice.historyUntitled")}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{new Date(item.submitted_at).toLocaleDateString(locale)}</span>
                  {item.paper_code && <span>{item.paper_code}</span>}
                  {pct !== null && (
                    <span className="font-semibold tabular-nums" style={{ color: scoreBandColor(pct) }}>
                      {formatScoreValue(item.score ?? 0)}/{formatScoreValue(item.total ?? 0)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {data.pagination.total_pages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft aria-hidden />
            {t("Practice.historyPrev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("Practice.historyPageOf", { page, total: data.pagination.total_pages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.total_pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Practice.historyNext")}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </>
  );
}
