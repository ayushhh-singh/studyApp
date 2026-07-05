import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentAffairsQuiz } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";

/** "Quiz me on this week" — builds a custom test from the last 7 days of CA-linked MCQs and jumps straight into the player. */
export function CurrentAffairsQuizButton() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const quiz = useCurrentAffairsQuiz();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        onClick={() => quiz.mutate(7, { onSuccess: (test) => navigate(`/${locale}/practice/test/${test.id}`) })}
        disabled={quiz.isPending}
      >
        <Sparkles aria-hidden />
        {quiz.isPending ? t("CurrentAffairs.quizCreating") : t("CurrentAffairs.quizMeButton")}
      </Button>
      {quiz.isError && <p className="max-w-64 text-right text-xs text-destructive">{t("CurrentAffairs.quizError")}</p>}
    </div>
  );
}
