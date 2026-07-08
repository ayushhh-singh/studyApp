import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MessageSquare, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { useLocale } from "@/hooks/use-locale";
import { useCommunityHub } from "@/hooks/use-community";

export const handle = { titleKey: "Community.hubTitle" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const hub = useCommunityHub();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("Community.hubTitle")} description={t("Community.hubDescription")} />

      <SectionCard title={t("Community.myThreads")}>
        {hub.isLoading ? (
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        ) : (hub.data?.my_threads.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Community.myThreadsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {hub.data!.my_threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/${locale}/community/thread/${thread.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{thread.post_count}</span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("Community.openPeerReview")}
        description={t("Community.openPeerReviewDescription")}
        action={
          <Link to={`/${locale}/community/shared-answers`} className="text-sm font-medium text-primary hover:underline">
            {t("Community.viewAll")}
          </Link>
        }
      >
        {hub.isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : (hub.data?.open_peer_review.length ?? 0) === 0 ? (
          <EmptyState icon={Sparkles} title={t("Community.peerReviewEmptyTitle")} description={t("Community.peerReviewEmptyDescription")} />
        ) : (
          <div className="flex flex-col gap-2">
            {hub.data!.open_peer_review.map((shared) => (
              <Link
                key={shared.id}
                to={`/${locale}/community/shared-answers/${shared.id}`}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {shared.overall_score !== null && shared.max_score !== null && (
                  <ScoreGauge value={Math.round((shared.overall_score / shared.max_score) * 100)} size={48} label="" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{shared.question_text_i18n[locale]}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("Community.replyCount", { count: shared.post_count })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("Community.recentThreads")}>
        {hub.isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : (hub.data?.recent_threads.length ?? 0) === 0 ? (
          <EmptyState icon={MessageSquare} title={t("Community.emptyTitle")} description={t("Community.recentThreadsEmptyDescription")} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {hub.data!.recent_threads.map((thread) => (
              <Link
                key={thread.id}
                to={`/${locale}/community/thread/${thread.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{thread.post_count}</span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
