import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, MessageCircleQuestion, MinusCircle, Sparkles, XCircle } from "lucide-react";
import type { AttemptReviewItem, BilingualText, Locale } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { ReportQuestionSheet } from "@/components/questions/report-question-sheet";
import { useAddQuestionToRevision } from "@/hooks/use-add-to-revision";
import { useExplainQuestion } from "@/hooks/use-explain-question";
import { formatSeconds } from "@/lib/format-duration";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { cn } from "@/lib/utils";

function ExplanationBlock({
  questionId,
  explanationI18n,
  locale,
  onGenerated,
}: {
  questionId: string;
  explanationI18n: BilingualText | null;
  locale: Locale;
  onGenerated: (explanation: BilingualText) => void;
}) {
  const { t } = useTranslation();
  const [explanation, setExplanation] = useState(explanationI18n);
  const { text, isStreaming, error, explain } = useExplainQuestion(questionId);

  if (explanation) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2.5 text-xs">
        <p>
          <span className="font-semibold text-foreground">EN — </span>
          {explanation.en}
        </p>
        <p lang="hi" className="leading-[1.75]">
          <span className="font-semibold text-foreground">HI — </span>
          {explanation.hi}
        </p>
      </div>
    );
  }

  // Checked before the streaming branch below: once generation errors out
  // (mid-stream or otherwise), `text` may already hold a partial fragment
  // from the deltas that did arrive — without this branch running first,
  // `isStreaming || text` would stay true forever and the retry button below
  // would never become reachable again.
  if (error) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-coral-foreground" role="alert">
          {error}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            explain(locale, (explanationI18n) => {
              setExplanation(explanationI18n);
              onGenerated(explanationI18n);
            })
          }
        >
          <Sparkles aria-hidden />
          {t("Practice.resultRetryExplanation")}
        </Button>
      </div>
    );
  }

  if (isStreaming || text) {
    return (
      <div className="rounded-md bg-muted/50 p-2.5 text-xs" lang={locale} aria-live="polite">
        {text}
        {isStreaming && (
          <span className="animate-pulse" aria-hidden>
            ▍
          </span>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() =>
        explain(locale, (explanationI18n) => {
          setExplanation(explanationI18n);
          onGenerated(explanationI18n);
        })
      }
    >
      <Sparkles aria-hidden />
      {t("Practice.resultGenerateExplanation")}
    </Button>
  );
}

function ReviewItem({
  item,
  locale,
  attemptId,
  onExplanationGenerated,
}: {
  item: AttemptReviewItem;
  locale: Locale;
  attemptId: string;
  onExplanationGenerated: (questionId: string, explanation: BilingualText) => void;
}) {
  const { t } = useTranslation();
  const addToRevision = useAddQuestionToRevision();

  return (
    <div role="listitem" className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <p className="text-sm whitespace-pre-line" lang={locale}>
        {formatQuestionStem(item.stem_i18n[locale])}
      </p>
      {item.options_i18n && (
        <ul className="flex flex-col gap-1 text-xs">
          {item.options_i18n.map((option) => {
            const isCorrectOpt = option.key === item.correct_option_key;
            const isWrongChosen = option.key === item.chosen_option_key && !isCorrectOpt;
            return (
              <li
                key={option.key}
                className={cn(
                  "flex items-start gap-1.5",
                  // text-*-foreground, not the raw token: on a card background the
                  // raw --tulsi/--coral colors read as low as ~2.5:1 in light mode.
                  isCorrectOpt && "font-semibold text-tulsi-foreground",
                  isWrongChosen && "font-semibold text-coral-foreground",
                )}
              >
                <span>{option.key}.</span>
                <span lang={locale}>{option.text_i18n[locale]}</span>
                {/* Color/weight alone convey correctness visually — mirror it as text for screen readers. */}
                {isCorrectOpt && <span className="sr-only"> — {t("Practice.resultsCorrect")}</span>}
                {isWrongChosen && <span className="sr-only"> — {t("Practice.resultsIncorrect")}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {item.is_correct === true && (
          <span className="flex items-center gap-1 text-tulsi-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t("Practice.resultsCorrect")}
          </span>
        )}
        {item.is_correct === false && (
          <span className="flex items-center gap-1 text-coral-foreground">
            <XCircle className="size-3.5" aria-hidden />
            {t("Practice.resultsIncorrect")}
          </span>
        )}
        {item.is_correct === null && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <MinusCircle className="size-3.5" aria-hidden />
            {t("Practice.resultsSkipped")}
          </span>
        )}
        <span className="text-muted-foreground">
          {t("Practice.resultsMarksAwarded", { marks: item.marks_awarded })}
        </span>
        {item.time_spent_seconds !== null && (
          <span className="text-muted-foreground">{formatSeconds(item.time_spent_seconds)}</span>
        )}
      </div>

      <ExplanationBlock
        questionId={item.question_id}
        explanationI18n={item.explanation_i18n}
        locale={locale}
        onGenerated={(explanation) => onExplanationGenerated(item.question_id, explanation)}
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={addToRevision.isPending || addToRevision.isSuccess}
          onClick={() => addToRevision.mutate(item.question_id)}
        >
          {addToRevision.isSuccess ? t("Learn.addedToRevision") : t("Learn.addToRevision")}
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link to={`/${locale}/doubts?question=${item.question_id}&attempt=${attemptId}`}>
            <MessageCircleQuestion aria-hidden />
            {t("Practice.resultAskDoubt")}
          </Link>
        </Button>
        <ReportQuestionSheet
          questionId={item.question_id}
          className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

// Mock/full-length papers put 100-150 review rows on this one page below the
// score summary; each row's height varies (option count, whether an
// explanation is expanded/streaming), so this window-scrolled virtualizer
// re-measures rows via ResizeObserver rather than assuming a fixed size —
// short lists (a 5-question custom test) just render every row with no
// virtualization overhead since the estimate covers the whole viewport.
export function ResultReviewList({
  items,
  locale,
  attemptId,
  onExplanationGenerated,
}: {
  items: AttemptReviewItem[];
  locale: Locale;
  attemptId: string;
  onExplanationGenerated: (questionId: string, explanation: BilingualText) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 160,
    overscan: 6,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      role="list"
      className="relative flex flex-col"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        return (
          <div
            key={item.question_id}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 pb-3"
            style={{ transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)` }}
          >
            <ReviewItem
              item={item}
              locale={locale}
              attemptId={attemptId}
              onExplanationGenerated={onExplanationGenerated}
            />
          </div>
        );
      })}
    </div>
  );
}
