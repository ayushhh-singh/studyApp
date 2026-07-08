import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronLeft, ChevronRight, Inbox, Lock } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useResolveReport, useReviewReports } from "@/hooks/use-review-reports";
import { queryKeys } from "@/lib/query-keys";

export function ReportsReviewPanel() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const queryClient = useQueryClient();

  const queue = useReviewReports(page, true);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const totalPages = queue.data?.pagination.total_pages ?? 1;
  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  const resolve = useResolveReport();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "community", "reports"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewCounts() });
  }, [queryClient]);

  useEffect(() => {
    if (!queue.isFetching && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [queue.isFetching, items.length, page]);
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  if (queue.isLoading) return <Skeleton className="h-72 w-full" />;
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title={t("ReviewReports.emptyTitle")} description={t("ReviewReports.emptyDescription")} />;
  }
  if (!current) return null;

  const act = (action: "dismiss" | "remove_content" | "lock_thread") =>
    resolve.mutate(
      { targetType: current.target_type, targetId: current.target_id, action },
      { onSuccess: refresh },
    );

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

      {resolve.error && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
          {resolve.error.message}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 font-medium text-coral-foreground">
            {t(`Community.reportReason.${current.reason}`)}
          </span>
          <span>{t("ReviewReports.reporterCount", { count: current.reporter_count })}</span>
          <span>{t(`ReviewReports.targetType.${current.target_type}`)}</span>
        </div>
        {current.detail && <p className="text-sm text-muted-foreground italic">"{current.detail}"</p>}
        {current.content ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              {current.content.author.handle ? `@${current.content.author.handle}` : current.content.author.display_name || t("Community.anonymous")}
            </p>
            <p className="text-sm whitespace-pre-wrap text-foreground">{current.content.preview_text}</p>
            {current.content.moderation_status === "removed" && (
              <span className="self-start rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {t("ReviewReports.alreadyRemoved")}
              </span>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">{t("ReviewReports.contentGone")}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button type="button" onClick={() => act("dismiss")} disabled={resolve.isPending} variant="outline">
          <Check className="size-4" /> {t("ReviewReports.dismiss")}
        </Button>
        <Button
          type="button"
          onClick={() => act("remove_content")}
          disabled={resolve.isPending}
          className="bg-coral text-white hover:bg-coral/90"
        >
          <Ban className="size-4" /> {t("ReviewReports.removeContent")}
        </Button>
        <Button type="button" variant="outline" onClick={() => act("lock_thread")} disabled={resolve.isPending}>
          <Lock className="size-4" /> {t("ReviewReports.lockThread")}
        </Button>
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
