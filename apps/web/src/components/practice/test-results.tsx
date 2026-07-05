import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import type { AttemptSubmitResult, Locale, TestDetail } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { scoreBandColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

export function TestResults({
  test,
  result,
  locale,
}: {
  test: TestDetail;
  result: AttemptSubmitResult;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const resultByQuestion = new Map(result.results.map((r) => [r.question_id, r]));
  const total = result.attempt.total ?? 0;
  const score = result.attempt.score ?? 0;
  const pct = total > 0 ? (score / total) * 100 : 0;

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-display text-5xl tabular-nums" style={{ color: scoreBandColor(pct) }}>
            {score}
            <span className="text-2xl text-muted-foreground">/{total}</span>
          </span>
          <p className="text-sm text-muted-foreground">{t("Practice.resultsScoreLabel")}</p>
        </div>

        <div className="flex flex-col gap-3">
          {test.questions.map((question) => {
            const r = resultByQuestion.get(question.id);
            return (
              <div
                key={question.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <p className="text-sm" lang={locale}>
                  {question.stem_i18n[locale]}
                </p>
                {question.options_i18n && r && (
                  <ul className="flex flex-col gap-1 text-xs">
                    {question.options_i18n.map((option) => (
                      <li
                        key={option.key}
                        className={cn(
                          "flex items-start gap-1.5",
                          option.key === r.correct_option_key && "font-semibold text-tulsi",
                          option.key === r.chosen_option_key &&
                            option.key !== r.correct_option_key &&
                            "font-semibold text-coral",
                        )}
                      >
                        <span>{option.key}.</span>
                        <span lang={locale}>{option.text_i18n[locale]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r && (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {r.is_correct === true && (
                      <span className="flex items-center gap-1 text-tulsi">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        {t("Practice.resultsCorrect")}
                      </span>
                    )}
                    {r.is_correct === false && (
                      <span className="flex items-center gap-1 text-coral">
                        <XCircle className="size-3.5" aria-hidden />
                        {t("Practice.resultsIncorrect")}
                      </span>
                    )}
                    {r.is_correct === null && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MinusCircle className="size-3.5" aria-hidden />
                        {t("Practice.resultsSkipped")}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {t("Practice.resultsMarksAwarded", { marks: r.marks_awarded })}
                    </span>
                  </div>
                )}
                {r?.explanation_i18n && (
                  <p className="rounded-md bg-muted/50 p-2 text-xs" lang={locale}>
                    {r.explanation_i18n[locale]}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <Button asChild className="self-center">
          <Link to={`/${locale}/practice`}>{t("Practice.resultsBackToPractice")}</Link>
        </Button>
      </div>
    </div>
  );
}
