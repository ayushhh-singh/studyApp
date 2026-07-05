import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { FileQuestion } from "lucide-react";
import type { AttemptSubmitResult } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { TestInstructions } from "@/components/practice/test-instructions";
import { TestPlayer } from "@/components/practice/test-player";
import { TestResults } from "@/components/practice/test-results";
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
  const [result, setResult] = useState<AttemptSubmitResult | null>(null);
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

  if (result) {
    return <TestResults test={test} result={result} locale={locale} />;
  }

  if (attemptId && startedAt) {
    if (!attemptDetail) return null;
    return (
      <TestPlayer
        test={test}
        attemptId={attemptId}
        startedAt={startedAt}
        initialAnswers={attemptDetail.answers}
        onSubmitted={setResult}
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
