import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Check, X, Pencil, ChevronLeft, ChevronRight, Inbox, Lock, Sparkles } from "lucide-react";
import {
  CA_BULK_APPROVE_BATCH_LIMIT,
  isHighConfidenceQuestion,
  reviewTabSchema,
  type ReviewEditBody,
  type ReviewTab,
} from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/review/review-card";
import { ReviewEditForm } from "@/components/review/review-edit-form";
import { NotesReviewPanel } from "@/components/review/notes-review-panel";
import { ReportsReviewPanel } from "@/components/review/reports-review-panel";
import { QuestionReportsReviewPanel } from "@/components/review/question-reports-review-panel";
import { MagazineReviewPanel } from "@/components/review/magazine-review-panel";
import {
  useAdminStatus,
  useCaBulkApproveHighConfidence,
  useCaHighConfidenceCount,
  useReviewApprove,
  useReviewBulkApprove,
  useReviewCounts,
  useReviewEdit,
  useReviewQueue,
  useReviewReject,
} from "@/hooks/use-review";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.review" };

const TABS: ReviewTab[] = [
  "generated_mcq",
  "generated_descriptive",
  "machine_translated",
  "current_affairs",
  "notes",
  "reports",
  "question_reports",
  "magazine",
];

export function Component() {
  const { t } = useTranslation();
  const { data: admin, isLoading: adminLoading } = useAdminStatus();
  const adminMode = admin?.admin_mode ?? false;

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = reviewTabSchema.safeParse(tabParam).success ? (tabParam as ReviewTab) : "generated_mcq";
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);

  const queryClient = useQueryClient();
  const counts = useReviewCounts(adminMode);
  const isNotesTab = tab === "notes";
  const isReportsTab = tab === "reports";
  const isQuestionReportsTab = tab === "question_reports";
  const isMagazineTab = tab === "magazine";
  const isCurrentAffairsTab = tab === "current_affairs";
  const caHighConfidence = useCaHighConfidenceCount(adminMode && isCurrentAffairsTab);
  const caBulkAll = useCaBulkApproveHighConfidence();
  const queue = useReviewQueue(tab, page, adminMode && !isNotesTab && !isReportsTab && !isQuestionReportsTab && !isMagazineTab);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const totalPages = queue.data?.pagination.total_pages ?? 1;

  const approve = useReviewApprove();
  const reject = useReviewReject();
  const edit = useReviewEdit();
  const bulk = useReviewBulkApprove();
  // caBulkAll can act on hundreds of rows sequentially (a whole-backlog
  // approve, not just the current page) and takes correspondingly longer —
  // folded into the same `pending` guard so a per-card approve/reject can't
  // race a row the bulk action is mid-way through touching.
  const pending = approve.isPending || reject.isPending || edit.isPending || bulk.isPending || caBulkAll.isPending;

  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  function setTab(next: ReviewTab) {
    setSearchParams((p) => {
      p.set("tab", next);
      return p;
    });
    setPage(1);
    setIndex(0);
    setEditing(false);
  }

  const refresh = useCallback(() => {
    // Invalidate every page of this tab (the acted item left needs_review) + the counts badges.
    queryClient.invalidateQueries({ queryKey: ["admin", "review", tab] });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewCounts() });
  }, [queryClient, tab]);

  // After a refetch empties the current page, step back a page if we can.
  useEffect(() => {
    if (!queue.isFetching && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [queue.isFetching, items.length, page]);

  // Keep the card index in range as the list shrinks.
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  const onApprove = useCallback(() => {
    if (!current || pending) return;
    approve.mutate(current.id, { onSuccess: refresh });
  }, [current, pending, approve, refresh]);

  const onReject = useCallback(() => {
    if (!current || pending) return;
    reject.mutate({ id: current.id }, { onSuccess: refresh });
  }, [current, pending, reject, refresh]);

  function onEditSubmit(body: ReviewEditBody, doApprove: boolean) {
    if (!current) return;
    edit.mutate(
      { id: current.id, body: { ...body, approve: doApprove } },
      {
        onSuccess: () => {
          setEditing(false);
          refresh();
        },
      },
    );
  }

  function onBulkApprove() {
    const ids = items.filter(isHighConfidenceQuestion).map((q) => q.id);
    if (ids.length === 0) return;
    bulk.mutate(ids, { onSuccess: refresh });
  }

  // Unlike onBulkApprove above (the current page's up-to-10 items), this acts
  // on the ENTIRE needs_review current-affairs backlog server-side — the
  // count comes from useCaHighConfidenceCount, not `items`.
  function onCaBulkApproveAll() {
    if (caBulkAll.isPending) return;
    caBulkAll.mutate(undefined, { onSuccess: refresh });
  }

  // Keyboard: j/k navigate, a approve, e edit, r reject (disabled while editing or typing in a field).
  useEffect(() => {
    if (!adminMode || editing || !current) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowright":
          setIndex((i) => Math.min(items.length - 1, i + 1));
          break;
        case "k":
        case "arrowleft":
          setIndex((i) => Math.max(0, i - 1));
          break;
        case "a":
          e.preventDefault();
          onApprove();
          break;
        case "r":
          e.preventDefault();
          onReject();
          break;
        case "e":
          e.preventDefault();
          setEditing(true);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminMode, editing, current, items.length, onApprove, onReject]);

  if (adminLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!adminMode) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("Review.title")} description={t("Review.description")} />
        <EmptyState icon={Lock} title={t("Review.disabledTitle")} description={t("Review.disabledDescription")} />
      </div>
    );
  }

  const highConfidenceCount = items.filter(isHighConfidenceQuestion).length;
  const caTotalCount = caHighConfidence.data?.count ?? 0;
  // A click only approves up to CA_BULK_APPROVE_BATCH_LIMIT (the backend
  // bounds a single request so a deep backlog can't risk a platform request
  // timeout) — show that honestly rather than a button promising more than
  // one click delivers; the count naturally drops after each click.
  const caButtonCount = Math.min(caTotalCount, CA_BULK_APPROVE_BATCH_LIMIT);
  const caHasMoreThanBatch = caTotalCount > CA_BULK_APPROVE_BATCH_LIMIT;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Review.title")}
        description={t("Review.description")}
        action={
          highConfidenceCount > 0 ? (
            <Button
              type="button"
              onClick={onBulkApprove}
              disabled={pending}
              className="bg-tulsi text-white hover:bg-tulsi/90"
            >
              <Check className="size-4" /> {t("Review.bulkApprove", { n: highConfidenceCount })}
            </Button>
          ) : undefined
        }
      />

      {/* tabs */}
      <div role="tablist" aria-label={t("Review.title")} className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tb) => {
          const c = counts.data?.[tb] ?? 0;
          const active = tb === tab;
          return (
            <button
              key={tb}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tb)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`Review.tab.${tb}`)}
              {c > 0 && (
                <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-primary/15 text-primary" : "bg-foreground/10")}>
                  {c}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isCurrentAffairsTab && caTotalCount > 0 && (
        <SectionCard className="border-tulsi/30 bg-tulsi/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-tulsi" />
              <div>
                <p className="text-sm font-medium">{t("Review.caHighConfidenceTitle", { n: caTotalCount })}</p>
                <p className="text-xs text-muted-foreground">{t("Review.caHighConfidenceDescription")}</p>
                {caHasMoreThanBatch && (
                  <p className="text-xs text-muted-foreground">
                    {t("Review.caBulkApproveBatchHint", { batch: CA_BULK_APPROVE_BATCH_LIMIT })}
                  </p>
                )}
              </div>
            </div>
            <Button
              type="button"
              onClick={onCaBulkApproveAll}
              disabled={caBulkAll.isPending}
              className="bg-tulsi text-white hover:bg-tulsi/90"
            >
              <Check className="size-4" />
              {caBulkAll.isPending ? t("Review.caBulkApproveAllPending") : t("Review.caBulkApproveAll", { n: caButtonCount })}
            </Button>
          </div>
        </SectionCard>
      )}

      {isNotesTab ? (
        <NotesReviewPanel />
      ) : isReportsTab ? (
        <ReportsReviewPanel />
      ) : isQuestionReportsTab ? (
        <QuestionReportsReviewPanel />
      ) : isMagazineTab ? (
        <MagazineReviewPanel />
      ) : queue.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title={t("Review.emptyTitle")} description={t("Review.emptyDescription")} />
      ) : current ? (
        <SectionCard>
          {/* card position + prev/next */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {t("Review.position", { current: index + 1, total: items.length })}
              {totalPages > 1 && ` · ${t("Learn.pageOf", { page, total: totalPages })}`}
            </span>
            <div className="flex gap-1">
              {/* Disabled while editing: an open edit form isn't keyed to
                  `current`, so navigating without saving/canceling first
                  used to leave stale text in the form while its Save button
                  silently submitted onto the NEWLY-navigated-to item's id. */}
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t("Review.prev")}
                disabled={index <= 0 || editing}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t("Review.next")}
                disabled={index >= items.length - 1 || editing}
                onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {editing ? (
            // key={current.id}: forces a full remount (fresh local state) if
            // `current` ever changes while editing — e.g. the items.length-1
            // clamp effect above shifting `index` after a concurrent
            // approve/reject elsewhere shrinks the queue — so the form can
            // never show item A's stale text while onSubmit closes over item
            // B's id. Belt-and-suspenders alongside disabling prev/next above.
            <ReviewEditForm
              key={current.id}
              question={current}
              onSubmit={onEditSubmit}
              onCancel={() => setEditing(false)}
              pending={pending}
            />
          ) : (
            <>
              <ReviewCard question={current} />
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button type="button" onClick={onApprove} disabled={pending} className="bg-tulsi text-white hover:bg-tulsi/90">
                  <Check className="size-4" /> {t("Review.approve")} <kbd className="ml-1 opacity-70">a</kbd>
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
                  <Pencil className="size-4" /> {t("Review.edit")} <kbd className="ml-1 opacity-70">e</kbd>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onReject}
                  disabled={pending}
                  className="border-coral/40 text-coral-foreground hover:bg-coral/10"
                >
                  <X className="size-4" /> {t("Review.reject")} <kbd className="ml-1 opacity-70">r</kbd>
                </Button>
                <span className="ml-auto self-center text-xs text-muted-foreground">{t("Review.keyboardHint")}</span>
              </div>
            </>
          )}

          {/* page navigation when the current page is exhausted */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setIndex(0); }}>
                {t("Learn.prevPage")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => { setPage((p) => p + 1); setIndex(0); }}
              >
                {t("Learn.nextPage")}
              </Button>
            </div>
          )}
        </SectionCard>
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> {t("Review.footerNote")}
      </p>
    </div>
  );
}
