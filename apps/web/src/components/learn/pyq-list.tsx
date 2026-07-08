import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import type { ExamCode, Locale, Question } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamYearChip } from "@/components/ui-x/exam-chip";
import { Button } from "@/components/ui/button";
import { useQuestion, useQuestions } from "@/hooks/use-questions";
import { cn } from "@/lib/utils";

function QuestionCard({
  question,
  locale,
  highlighted,
}: {
  question: Question;
  locale: Locale;
  highlighted?: boolean;
}) {
  const { t } = useTranslation();
  const [showExplanation, setShowExplanation] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  // Scroll the cited question into view once, on mount — matches the ring
  // highlight convention already used for "the current item" elsewhere in
  // the app (question-palette.tsx's active-question ring).
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li
      ref={ref}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
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
  highlightId,
}: {
  nodeId: string;
  locale: Locale;
  page: number;
  onPageChange: (page: number) => void;
  exam?: ExamCode;
  /**
   * A specific question to surface prominently — from a mentor citation deep
   * link (?qid=). There's no per-question detail page and no server support
   * for "which page is question X on" (ordering/pagination is fixed
   * server-side), so rather than build fragile page-jump logic, the cited
   * question is fetched independently and always shown first, ring-highlighted
   * and auto-scrolled to — regardless of which page of the normal list it'd
   * otherwise fall on, or whether it's on the current page at all.
   */
  highlightId?: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuestions({ node: nodeId, page, exam });
  const { data: highlightedQuestion } = useQuestion(highlightId);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (data.items.length === 0 && !highlightedQuestion) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("Learn.noPyqsTitle")}
        description={t("Learn.noPyqsDescription")}
      />
    );
  }

  const onCurrentPage = highlightId ? data.items.some((q) => q.id === highlightId) : false;
  const groups = groupByYearDescending(data.items);

  return (
    <div className="flex flex-col gap-4">
      {/* Referenced question — shown once, above the normal list, when it
          isn't already on the currently-displayed page. */}
      {highlightedQuestion && !onCurrentPage && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-primary uppercase">
            {t("Learn.referencedQuestion")}
          </h3>
          <ul className="flex flex-col gap-2">
            <QuestionCard question={highlightedQuestion} locale={locale} highlighted />
          </ul>
        </div>
      )}
      {groups.map(([year, questions]) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {year === "unknown" ? t("Learn.yearUnknown") : year}
          </h3>
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                locale={locale}
                highlighted={question.id === highlightId}
              />
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
