import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CheckCircle2, MessageCircleQuestion, MinusCircle, Sparkles, XCircle } from "lucide-react";
import type { AttemptReviewItem, BilingualText, Locale } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { useAddQuestionToRevision } from "@/hooks/use-add-to-revision";
import { useExplainQuestion } from "@/hooks/use-explain-question";
import { formatSeconds } from "@/lib/format-duration";
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
        <p className="text-xs text-coral">{error}</p>
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
      <div className="rounded-md bg-muted/50 p-2.5 text-xs" lang={locale}>
        {text}
        {isStreaming && <span className="animate-pulse">▍</span>}
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
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <p className="text-sm" lang={locale}>
        {item.stem_i18n[locale]}
      </p>
      {item.options_i18n && (
        <ul className="flex flex-col gap-1 text-xs">
          {item.options_i18n.map((option) => (
            <li
              key={option.key}
              className={cn(
                "flex items-start gap-1.5",
                option.key === item.correct_option_key && "font-semibold text-tulsi",
                option.key === item.chosen_option_key &&
                  option.key !== item.correct_option_key &&
                  "font-semibold text-coral",
              )}
            >
              <span>{option.key}.</span>
              <span lang={locale}>{option.text_i18n[locale]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {item.is_correct === true && (
          <span className="flex items-center gap-1 text-tulsi">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t("Practice.resultsCorrect")}
          </span>
        )}
        {item.is_correct === false && (
          <span className="flex items-center gap-1 text-coral">
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
      </div>
    </li>
  );
}

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
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <ReviewItem
          key={item.question_id}
          item={item}
          locale={locale}
          attemptId={attemptId}
          onExplanationGenerated={onExplanationGenerated}
        />
      ))}
    </ul>
  );
}
