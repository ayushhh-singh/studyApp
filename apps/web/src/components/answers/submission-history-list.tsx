import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Camera, ChevronLeft, ChevronRight, History } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
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
  const { data, isLoading, isError, refetch } = useSubmissions(page);

  return (
    <SectionCard title={t("Answers.historyTitle")}>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
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
                    {item.mode === "handwritten" && <Camera className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden />}
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
              // Every status now resolves to a real destination — there used to be
              // no click target at all for a typed submission stuck in
              // 'evaluating' (e.g. the tab was closed mid-stream), 'failed'
              // (the model call errored), or a transient 'pending', even though
              // the evaluation page can resume/retry all three (planEvaluation
              // replays a finished run, reclaims a genuinely stale 'evaluating'
              // row, or retries a 'failed'/'pending' one fresh — see
              // apps/api/src/services/evaluation/evaluate.ts). A handwritten
              // submission not yet confirmed (pending/ocr_processing/ocr_done)
              // still needs the confirm screen first.
              const resumeHref =
                item.status === "complete" || item.status === "evaluating" || item.status === "failed"
                  ? `/${locale}/answers/evaluation/${item.id}`
                  : item.mode === "handwritten"
                    ? `/${locale}/answers/confirm/${item.id}`
                    : `/${locale}/answers/evaluation/${item.id}`;
              return (
                <li key={item.id}>
                  <Link
                    to={resumeHref}
                    className="block rounded-lg transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row}
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
