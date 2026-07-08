import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { NotebookPen, PenTool } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { TodaysQuestionCard } from "@/components/answers/todays-question-card";
import { DailyAnswerSet } from "@/components/answers/daily-answer-set";
import { PyqPicker } from "@/components/answers/pyq-picker";
import { SubmissionHistoryList } from "@/components/answers/submission-history-list";
import { useTodaysQuestion } from "@/hooks/use-answers";
import { useLocale } from "@/hooks/use-locale";
import { EvaluationQuotaChip } from "@/components/billing/quota-chip";

export const handle = { titleKey: "Nav.answers" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: todaysQuestion, isLoading: isTodaysQuestionLoading } = useTodaysQuestion();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Answers.title")}
        description={t("Answers.description")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <EvaluationQuotaChip />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold/15 px-3 py-1 text-xs font-semibold text-marigold-foreground">
              <NotebookPen className="size-3.5" aria-hidden />
              {t("Answers.flagshipBadge")}
            </span>
          </div>
        }
      />

      <TodaysQuestionCard question={todaysQuestion} isLoading={isTodaysQuestionLoading} />

      <DailyAnswerSet />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <PyqPicker />

        <SectionCard title={t("Answers.writeOwnTitle")} className="border-primary/20">
          <p className="text-sm text-muted-foreground">{t("Answers.writeOwnDescription")}</p>
          <Link
            to={`/${locale}/answers/write`}
            className="inline-flex h-10 w-fit items-center gap-1.5 self-start rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PenTool className="size-4" aria-hidden />
            {t("Answers.writeOwnCta")}
          </Link>
        </SectionCard>
      </div>

      <SubmissionHistoryList />
    </div>
  );
}
