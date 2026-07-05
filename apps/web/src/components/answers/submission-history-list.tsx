import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { SubmissionStatusChip } from "@/components/answers/submission-status-chip";
import { useSubmissions } from "@/hooks/use-answers";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";

export function SubmissionHistoryList() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSubmissions(page);

  return (
    <SectionCard title={t("Answers.historyTitle")}>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("Answers.historyEmptyTitle")}
          description={t("Answers.historyEmptyDescription")}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {data.items.map((item) => {
              const stem = item.question_stem_i18n?.[locale];
              const pct =
                item.overall_score !== null && item.max_score ? (item.overall_score / item.max_score) * 100 : null;
              const row = (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
                  <p className="line-clamp-2 text-sm" lang={locale}>
                    {stem || t("Answers.historyUntitled")}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{new Date(item.created_at).toLocaleDateString(locale)}</span>
                    <SubmissionStatusChip status={item.status} />
                    {pct !== null && (
                      <span className="font-semibold tabular-nums" style={{ color: scoreBandColor(pct) }}>
                        {item.overall_score}/{item.max_score}
                      </span>
                    )}
                  </div>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.status === "complete" ? (
                    <Link
                      to={`/${locale}/answers/evaluation/${item.id}`}
                      className="block rounded-lg transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
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
                {t("Answers.historyPrev")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("Answers.historyPageOf", { page, total: data.pagination.total_pages })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("Answers.historyNext")}
                <ChevronRight aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
