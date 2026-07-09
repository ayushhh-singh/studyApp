import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { AnswerSessionPlayer } from "@/components/answers/answer-session-player";
import { useStartAnswerSession, useAnswerSession } from "@/hooks/use-answer-sessions";
import { useLocale } from "@/hooks/use-locale";

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const { testId } = useParams<{ testId: string }>();
  const startSession = useStartAnswerSession(testId);
  const { data: detail, isLoading } = useAnswerSession(startSession.data?.id);

  function handleExit() {
    navigate(`/${locale}/answers`);
  }

  if (startSession.isError) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <EmptyState
          icon={FileQuestion}
          title={t("Practice.testNotFoundTitle")}
          description={t("Practice.testNotFoundDescription")}
          action={<Button onClick={handleExit}>{t("Answers.backToAnswers")}</Button>}
        />
      </div>
    );
  }

  if (isLoading || !detail) return null;

  return (
    <AnswerSessionPlayer
      detail={detail}
      locale={locale}
      onExit={handleExit}
      onFinished={() => navigate(`/${locale}/answers/session/${detail.session.id}/result`)}
    />
  );
}
