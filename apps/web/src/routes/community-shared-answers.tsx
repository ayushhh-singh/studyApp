import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useLocale } from "@/hooks/use-locale";
import { useSharedAnswers } from "@/hooks/use-community";

export const handle = { titleKey: "Community.peerReviewFeedTitle" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const feed = useSharedAnswers(page);
  const items = feed.data?.items ?? [];
  const totalPages = feed.data?.pagination.total_pages ?? 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("Community.peerReviewFeedTitle")} description={t("Community.peerReviewFeedDescription")} />

      {feed.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Sparkles} title={t("Community.peerReviewEmptyTitle")} description={t("Community.peerReviewEmptyDescription")} />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((shared) => {
            const scorePct =
              shared.overall_score !== null && shared.max_score !== null
                ? Math.round((shared.overall_score / shared.max_score) * 100)
                : null;
            return (
              <Link
                key={shared.id}
                to={`/${locale}/community/shared-answers/${shared.id}`}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {scorePct !== null && <ScoreGauge value={scorePct} size={56} />}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{shared.question_text_i18n[locale]}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("Community.replyCount", { count: shared.post_count })} · {t("Community.helpfulCount", { count: shared.helpful_count })}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("Learn.prevPage")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("Learn.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
