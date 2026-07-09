import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CalendarDays, PenLine } from "lucide-react";
import type { Question } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";

export function TodaysQuestionCard({
  question,
  isLoading,
  isError,
  onRetry,
}: {
  question: Question | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard
      title={t("Answers.todaysQuestionTitle")}
      className="border-marigold/30"
      action={
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          {new Date().toLocaleDateString(locale, { day: "numeric", month: "short" })}
        </span>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => onRetry?.()} />
      ) : !question ? (
        <EmptyState
          icon={PenLine}
          title={t("Answers.todaysQuestionEmptyTitle")}
          description={t("Answers.todaysQuestionEmptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-base leading-[1.75]" lang={locale}>
            {question.stem_i18n[locale]}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{question.paper_code}</span>
            {question.marks !== null && <span>{t("Answers.marks", { count: question.marks })}</span>}
            {question.word_limit !== null && <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>}
          </div>
          <Button asChild className="self-start">
            <Link to={`/${locale}/answers/write?question=${question.id}`}>
              <PenLine aria-hidden />
              {t("Answers.writeAnswerCta")}
            </Link>
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
