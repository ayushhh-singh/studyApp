import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { FileQuestion } from "lucide-react";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { SubmissionStatusChip } from "@/components/answers/submission-status-chip";
import { useAnswerSessionResult } from "@/hooks/use-answer-sessions";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";
import { formatQuestionStem } from "@/lib/format-question-stem";

export const handle = { titleKey: "Nav.answers" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const { data: result, isLoading, isError } = useAnswerSessionResult(sessionId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (isError || !result) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("Nav.answers")} />
        <EmptyState
          icon={FileQuestion}
          title={t("Answers.sessionResultNotFoundTitle")}
          description={t("Answers.sessionResultNotFoundDescription")}
          action={
            <Button asChild>
              <Link to={`/${locale}/answers`}>{t("Answers.backToAnswers")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const pct = result.total_score !== null && result.total_max_score ? (result.total_score / result.total_max_score) * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: t("Nav.answers"), to: `/${locale}/answers` }, { label: t("Answers.sessionResultBreadcrumb") }]} />
      <PageHeader title={result.test_title_i18n[locale]} description={t("Answers.sessionResultDescription")} />

      <SectionCard>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {t("Answers.sessionAttempted", { attempted: result.attempted_count, total: result.total_count })}
          </span>
          {pct !== null && (
            <span className="font-semibold tabular-nums" style={{ color: scoreBandColor(pct) }}>
              {result.total_score}/{result.total_max_score}
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t("Answers.sessionResultQuestions")}>
        <ul className="flex flex-col gap-2">
          {result.items.map((item, index) => {
            const s = item.submission;
            const row = (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
                <p className="line-clamp-2 text-sm whitespace-pre-line" lang={locale}>
                  {t("Practice.questionOf", { current: index + 1, total: result.items.length })} —{" "}
                  {formatQuestionStem(item.stem_i18n[locale])}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {item.marks !== null && <span>{t("Answers.marks", { count: item.marks })}</span>}
                  {s ? (
                    <SubmissionStatusChip status={s.status} />
                  ) : (
                    <span className="italic">{t("Answers.sessionNotAttempted")}</span>
                  )}
                  {s?.overall_score !== null && s?.overall_score !== undefined && (
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: scoreBandColor(((s.overall_score ?? 0) / (s.max_score || 1)) * 100) }}
                    >
                      {s.overall_score}/{s.max_score}
                    </span>
                  )}
                </div>
              </div>
            );
            // Mirrors submission-history-list.tsx: a handwritten submission
            // not yet confirmed needs the OCR trust-loop screen first.
            const resumeHref = s
              ? s.mode === "handwritten" && (s.status === "pending" || s.status === "ocr_processing" || s.status === "ocr_done")
                ? `/${locale}/answers/confirm/${s.submission_id}`
                : `/${locale}/answers/evaluation/${s.submission_id}`
              : null;
            return (
              <li key={item.question_id}>
                {resumeHref ? (
                  <Link
                    to={resumeHref}
                    className="block rounded-lg transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}
