import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileQuestion, Ghost } from "lucide-react";
import type { BilingualText } from "@neev/shared";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { ResultScoreHero } from "@/components/practice/result-score-hero";
import { CutoffComparison } from "@/components/practice/cutoff-comparison";
import { ResultTopicBreakdown } from "@/components/practice/result-topic-breakdown";
import { ResultReviewList } from "@/components/practice/result-review-list";
import { RankCard } from "@/components/scoreboard/rank-card";
import { useAttemptResult } from "@/hooks/use-attempt";
import { useAttemptRankCard } from "@/hooks/use-scoreboard";
import { useLocale } from "@/hooks/use-locale";
import { queryKeys } from "@/lib/query-keys";
import { ApiError } from "@/lib/api";

export const handle = { titleKey: "Nav.practice" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { attemptId = "" } = useParams<{ attemptId: string }>();
  const { data: result, isLoading, error } = useAttemptResult(attemptId);
  const { data: rankCard } = useAttemptRankCard(attemptId);

  const handleExplanationGenerated = useCallback(
    (questionId: string, explanation: BilingualText) => {
      queryClient.setQueryData(queryKeys.attemptResult(attemptId), (old: typeof result) =>
        old
          ? {
              ...old,
              review: old.review.map((item) =>
                item.question_id === questionId ? { ...item, explanation_i18n: explanation } : item,
              ),
            }
          : old,
      );
    },
    [queryClient, attemptId],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !result) {
    const message = error instanceof ApiError ? error.message : null;
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          icon={FileQuestion}
          title={t("Practice.resultNotFoundTitle")}
          description={message ?? t("Practice.resultNotFoundDescription")}
          action={
            <Button asChild>
              <Link to={`/${locale}/practice`}>{t("Practice.resultsBackToPractice")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("Nav.practice"), to: `/${locale}/practice` },
          { label: t("Practice.resultBreadcrumb") },
        ]}
      />
      <PageHeader
        title={result.test ? result.test.title_i18n[locale] : t("Practice.resultBreadcrumb")}
        description={t("Practice.resultSubmittedAt", {
          date: new Date(result.attempt.submitted_at ?? result.attempt.started_at).toLocaleString(locale),
        })}
      />

      <ResultScoreHero result={result} />

      <RankCard card={rankCard} />

      {result.test && result.attempted_count > 0 && (
        <div className="flex flex-col items-center gap-1.5">
          <Button asChild variant="outline">
            <Link to={`/${locale}/practice/ghost/${attemptId}`}>
              <Ghost aria-hidden />
              {t("Ghost.raceThisAgain")}
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">{t("Ghost.raceThisAgainHint")}</span>
        </div>
      )}

      {result.test?.kind === "mock" && <CutoffComparison result={result} />}

      <SectionCard title={t("Practice.resultTopicBreakdownTitle")}>
        <ResultTopicBreakdown items={result.topic_breakdown} locale={locale} />
      </SectionCard>

      <SectionCard title={t("Practice.resultReviewTitle")}>
        <ResultReviewList
          items={result.review}
          locale={locale}
          attemptId={attemptId}
          onExplanationGenerated={handleExplanationGenerated}
        />
      </SectionCard>

      <Button asChild className="self-center">
        <Link to={`/${locale}/practice`}>{t("Practice.resultsBackToPractice")}</Link>
      </Button>
    </div>
  );
}
