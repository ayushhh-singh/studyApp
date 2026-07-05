import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { TestInstructions } from "@/components/practice/test-instructions";
import { TestPlayer } from "@/components/practice/test-player";
import { useTest } from "@/hooks/use-tests";
import { useAttemptDetail, useStartAttempt } from "@/hooks/use-attempt";
import { useLocale } from "@/hooks/use-locale";

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const { testId = "" } = useParams<{ testId: string }>();
  const { data: test, isLoading, isError } = useTest(testId);
  const startAttempt = useStartAttempt();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const { data: attemptDetail } = useAttemptDetail(attemptId ?? undefined);

  function handleStart() {
    startAttempt.mutate(
      { test_id: testId },
      {
        onSuccess: (attempt) => {
          setAttemptId(attempt.id);
          setStartedAt(attempt.started_at);
        },
      },
    );
  }

  if (isLoading) return null;

  if (isError || !test) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <EmptyState
          icon={FileQuestion}
          title={t("Practice.testNotFoundTitle")}
          description={t("Practice.testNotFoundDescription")}
          action={<Button onClick={() => navigate(`/${locale}/practice`)}>{t("Practice.backToPractice")}</Button>}
        />
      </div>
    );
  }

  if (attemptId && startedAt) {
    if (!attemptDetail) return null;
    return (
      <TestPlayer
        test={test}
        attemptId={attemptId}
        startedAt={startedAt}
        initialAnswers={attemptDetail.answers}
        onSubmitted={(result) => navigate(`/${locale}/practice/attempt/${result.attempt.id}/result`)}
        locale={locale}
      />
    );
  }

  return (
    <TestInstructions
      test={test}
      locale={locale}
      onStart={handleStart}
      isStarting={startAttempt.isPending}
      error={startAttempt.error}
    />
  );
}
