import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import type { ExamCode, Locale, Question } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamYearChip } from "@/components/ui-x/exam-chip";
import { Button } from "@/components/ui/button";
import { useQuestions } from "@/hooks/use-questions";
import { cn } from "@/lib/utils";

function QuestionCard({ question, locale }: { question: Question; locale: Locale }) {
  const { t } = useTranslation();
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Year is the group header, so the chip shows only the exam here. */}
        <ExamYearChip
          examCode={question.exam_code}
          examLabel={question.exam_label_i18n}
          outOfSyllabus={question.out_of_syllabus}
        />
      </div>
      <p className="text-sm">{question.stem_i18n[locale]}</p>
      {question.options_i18n && (
        <ul className="flex flex-col gap-1 text-xs">
          {question.options_i18n.map((option) => (
            <li
              key={option.key}
              className={cn(
                "flex gap-1.5",
                option.key === question.correct_option_key
                  ? "font-semibold text-tulsi"
                  : "text-muted-foreground",
              )}
            >
              <span>{option.key}.</span>
              <span>{option.text_i18n[locale]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {question.marks != null && <span>{t("Learn.marks", { count: question.marks })}</span>}
        {question.word_limit != null && <span>{t("Learn.wordLimit", { count: question.word_limit })}</span>}
        {question.explanation_i18n && (
          <button
            type="button"
            onClick={() => setShowExplanation((v) => !v)}
            className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showExplanation ? t("Learn.hideExplanation") : t("Learn.showExplanation")}
          </button>
        )}
      </div>
      {showExplanation && question.explanation_i18n && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2.5 text-xs">
          <p>
            <span className="font-semibold text-foreground">EN — </span>
            {question.explanation_i18n.en}
          </p>
          <p lang="hi" className="leading-[1.75]">
            <span className="font-semibold text-foreground">HI — </span>
            {question.explanation_i18n.hi}
          </p>
        </div>
      )}
    </li>
  );
}

function groupByYearDescending(questions: Question[]): [string, Question[]][] {
  const byYear = new Map<string, Question[]>();
  for (const question of questions) {
    const key = question.year ? String(question.year) : "unknown";
    const bucket = byYear.get(key) ?? [];
    bucket.push(question);
    byYear.set(key, bucket);
  }
  return [...byYear.entries()].sort(([a], [b]) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return Number(b) - Number(a);
  });
}

export function PyqList({
  nodeId,
  locale,
  page,
  onPageChange,
  exam,
}: {
  nodeId: string;
  locale: Locale;
  page: number;
  onPageChange: (page: number) => void;
  exam?: ExamCode;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuestions({ node: nodeId, page, exam });

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("Learn.noPyqsTitle")}
        description={t("Learn.noPyqsDescription")}
      />
    );
  }

  const groups = groupByYearDescending(data.items);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([year, questions]) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {year === "unknown" ? t("Learn.yearUnknown") : year}
          </h3>
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <QuestionCard key={question.id} question={question} locale={locale} />
            ))}
          </ul>
        </div>
      ))}
      {data.pagination.total_pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t("Learn.prevPage")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("Learn.pageOf", { page, total: data.pagination.total_pages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.total_pages}
            onClick={() => onPageChange(page + 1)}
          >
            {t("Learn.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
