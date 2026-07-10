import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronLeft, ChevronRight, Inbox, RefreshCw, Wrench } from "lucide-react";
import type { QuestionReportAction } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/review/review-card";
import { useQuestionReportsQueue, useResolveQuestionReport } from "@/hooks/use-question-reports";
import { queryKeys } from "@/lib/query-keys";

export function QuestionReportsReviewPanel() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [fixKey, setFixKey] = useState("");
  const queryClient = useQueryClient();

  const queue = useQuestionReportsQueue(page, true);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const totalPages = queue.data?.pagination.total_pages ?? 1;
  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  const resolve = useResolveQuestionReport();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "question-reports"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewCounts() });
  }, [queryClient]);

  useEffect(() => {
    if (!queue.isFetching && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [queue.isFetching, items.length, page]);
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);
  useEffect(() => {
    setFixKey(current?.question.correct_option_key ?? "");
  }, [current?.question_id, current?.question.correct_option_key]);

  if (queue.isLoading) return <Skeleton className="h-72 w-full" />;
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title={t("QuestionReports.emptyTitle")} description={t("QuestionReports.emptyDescription")} />;
  }
  if (!current) return null;

  const act = (action: QuestionReportAction, correctKey?: string) =>
    resolve.mutate({ questionId: current.question_id, action, correctKey }, { onSuccess: refresh });

  const p = current.provenance;
  const optionKeys = (current.question.options_i18n ?? []).map((o) => o.key);

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("Review.position", { current: index + 1, total: items.length })}
          {totalPages > 1 && ` · ${t("Learn.pageOf", { page, total: totalPages })}`}
        </span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.prev")} disabled={index <= 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.next")} disabled={index >= items.length - 1} onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* report + provenance banner */}
      <div className="flex flex-col gap-2 rounded-lg border border-coral/30 bg-coral/5 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 font-medium text-coral-foreground">
            {t("QuestionReports.reportCount", { count: current.report_count })}
          </span>
          {current.reasons.map((r) => (
            <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {t(`ReportQuestion.reason.${r}`)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{t("QuestionReports.sourceKind")}: <strong className="text-foreground">{p.source_kind ?? "—"}</strong></span>
          <span>{t("QuestionReports.exam")}: {p.exam_code ?? "—"}{p.year ? ` ${p.year}` : ""}</span>
          {p.prompt_version && <span>{t("QuestionReports.promptVersion")}: {p.prompt_version}</span>}
          {p.answer_key_verified && <span className="text-tulsi-foreground">{t("QuestionReports.keyVerified")}</span>}
          <span>{t("QuestionReports.state")}: {p.review_state}{p.is_published ? "" : ` · ${t("QuestionReports.unpublished")}`}</span>
        </div>
        {current.reports.some((r) => r.detail) && (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {current.reports.filter((r) => r.detail).slice(0, 5).map((r, i) => (
              <li key={i} className="italic">"{r.detail}"</li>
            ))}
          </ul>
        )}
      </div>

      <ReviewCard question={current.question} />

      {resolve.error && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">{resolve.error.message}</div>
      )}

      {/* actions */}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium">{t("QuestionReports.correctKey")}</label>
          <select
            value={fixKey}
            onChange={(e) => setFixKey(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {optionKeys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <Button type="button" variant="outline" disabled={resolve.isPending || !fixKey || current.question.type !== "mcq"} onClick={() => act("fix_key", fixKey)}>
            <Wrench className="size-4" /> {t("QuestionReports.fixKey")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={resolve.isPending || current.question.type !== "mcq"} onClick={() => act("regenerate_explanation")}>
            <RefreshCw className="size-4" /> {t("QuestionReports.regenerateExplanation")}
          </Button>
          <Button type="button" variant="outline" className="border-coral/40 text-coral-foreground hover:bg-coral/10" disabled={resolve.isPending} onClick={() => act("unpublish")}>
            <Ban className="size-4" /> {t("QuestionReports.unpublish")}
          </Button>
          <Button type="button" variant="outline" disabled={resolve.isPending} onClick={() => act("dismiss")}>
            <Check className="size-4" /> {t("QuestionReports.dismiss")}
          </Button>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setIndex(0); }}>
            {t("Learn.prevPage")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setIndex(0); }}>
            {t("Learn.nextPage")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
