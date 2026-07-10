import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useLocale } from "@/hooks/use-locale";
import { useSharedAnswer, useCommunityThread } from "@/hooks/use-community";
import { PostList } from "@/components/community/post-list";
import { PostComposer } from "@/components/community/post-composer";
import { CommunityAuthorLine } from "@/components/community/community-author-line";
import { formatQuestionStem } from "@/lib/format-question-stem";

export const handle = { titleKey: "Community.peerReviewTitle" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const shared = useSharedAnswer(id);
  const thread = useCommunityThread(shared.data?.thread_id);

  if (shared.isLoading || thread.isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!shared.data) {
    return <p className="text-sm text-muted-foreground">{t("Community.peerReviewNotFound")}</p>;
  }

  const answer = shared.data;
  const scorePct =
    answer.overall_score !== null && answer.max_score !== null
      ? Math.round((answer.overall_score / answer.max_score) * 100)
      : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        to={`/${locale}/community`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> {t("Community.backToHub")}
      </Link>

      <PageHeader title={t("Community.peerReviewTitle")} description={t("Community.peerReviewDescription")} />

      <SectionCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {scorePct !== null && <ScoreGauge value={scorePct} label={t("Community.overallScore")} size={120} />}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CommunityAuthorLine author={answer.author} className="font-medium text-foreground" />
              <span>{new Date(answer.created_at).toLocaleDateString(locale)}</span>
            </div>
            <p className="text-sm font-semibold whitespace-pre-line text-foreground">
              {formatQuestionStem(answer.question_text_i18n[locale])}
            </p>
            {answer.answer_text && (
              <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm text-foreground">{answer.answer_text}</p>
            )}
            {answer.dimension_scores && answer.dimension_scores.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {answer.dimension_scores.map((d) => (
                  <span key={d.key} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium">
                    {d.label}: {d.score}/10
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("Community.discussion")}>
        {thread.data && <PostList threadId={thread.data.thread.id} posts={thread.data.posts} />}
        {thread.data && <PostComposer threadId={thread.data.thread.id} />}
      </SectionCard>
    </div>
  );
}
