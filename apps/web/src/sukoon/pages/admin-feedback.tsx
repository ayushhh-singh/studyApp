/**
 * Session 14 — admin feedback list: every thumbs/note submitted through the
 * feedback widget (Saathi replies, journey completions, the general feedback
 * page), newest first. Self-gated the same way admin-journeys.tsx is (no
 * router-level guard — checks `is_admin` itself via Sukoon's OWN /admin/status
 * probe, never Neev's, per the module isolation rule) rather than a route-level
 * guard.
 */
import { useState } from "react";
import { Lock, ThumbsUp, ThumbsDown, MessageSquareHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonAdminStatus } from "@/sukoon/lib/use-sukoon-admin-journeys";
import { useAdminSukoonFeedback } from "@/sukoon/lib/use-sukoon-feedback";

const PAGE_SIZE = 30;

export function Component() {
  const { t, language } = useSukoonLanguage();
  const statusQuery = useSukoonAdminStatus();
  const [page, setPage] = useState(1);
  const listQuery = useAdminSukoonFeedback(page, { enabled: !!statusQuery.data?.is_admin });

  if (statusQuery.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.admin.feedback.title")} />
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {t("Sukoon.admin.feedback.loadError")}
        </p>
      </div>
    );
  }

  if (!statusQuery.data?.is_admin) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.admin.feedback.title")} />
        <EmptyState
          icon={Lock}
          title={t("Sukoon.admin.journeys.deniedTitle")}
          description={t("Sukoon.admin.journeys.deniedBody")}
        />
      </div>
    );
  }

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6" lang={language}>
      <PageHeader
        title={t("Sukoon.admin.feedback.title")}
        description={t("Sukoon.admin.feedback.sub", { count: total })}
      />

      {listQuery.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {t("Sukoon.admin.feedback.loadError")}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title={t("Sukoon.admin.feedback.emptyTitle")}
          description={t("Sukoon.admin.feedback.emptyBody")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((f) => (
            <div key={f.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`Sukoon.admin.feedback.target_${f.target_type}`)}
                </span>
                <div className="flex items-center gap-2">
                  {f.rating === "up" ? <ThumbsUp className="size-4 text-tulsi" aria-hidden /> : null}
                  {f.rating === "down" ? <ThumbsDown className="size-4 text-destructive" aria-hidden /> : null}
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString(language === "hi" ? "hi-IN" : "en-IN")}
                  </span>
                </div>
              </div>
              {f.body_text ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{f.body_text}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("Sukoon.journal.prev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("Sukoon.journal.pageOf", { current: page, total: totalPages })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("Sukoon.journal.next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
