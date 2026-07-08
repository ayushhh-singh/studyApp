import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Flame, Timer, Trophy, X, Zap } from "lucide-react";
import type { TimeAttackResult, TimeAttackStart, TimeAttackTopic } from "@prayasup/shared";
import { TIME_ATTACK_MINUTES, TIME_ATTACK_SIZE } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui-x/skeleton";
import { TestPlayer } from "@/components/practice/test-player";
import { useTimeAttackTopics, useStartTimeAttack, useFinishTimeAttack } from "@/hooks/use-time-attack";
import { useLocale } from "@/hooks/use-locale";

function Shell({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onExit} aria-label={t("Practice.exit")}>
          <X aria-hidden />
        </Button>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Zap className="size-4 text-marigold" aria-hidden />
          {t("TimeAttack.title")}
        </span>
      </header>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">{children}</div>
    </div>
  );
}

function TopicPicker({ onPick }: { onPick: (topic: TimeAttackTopic) => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: topics, isLoading } = useTimeAttackTopics();
  const startTA = useStartTimeAttack();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">{t("TimeAttack.pickTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("TimeAttack.rules", { count: TIME_ATTACK_SIZE, minutes: TIME_ATTACK_MINUTES })}
        </p>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(topics ?? []).map((topic) => (
            <button
              key={topic.node_id}
              type="button"
              disabled={startTA.isPending}
              onClick={() => onPick(topic)}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-start shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold" lang={locale}>
                  {topic.is_all_csat ? t("TimeAttack.allCsat") : topic.title_i18n[locale]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("TimeAttack.available", { count: topic.available })}
                </span>
              </div>
              {topic.personal_best ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-marigold/15 px-2.5 py-1 text-xs font-semibold text-marigold-foreground">
                  <Trophy className="size-3.5" aria-hidden />
                  {topic.personal_best.best_correct}/{topic.personal_best.best_total}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{t("TimeAttack.noBest")}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EndScreen({
  result,
  onAgain,
  onDone,
}: {
  result: TimeAttackResult;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const mins = Math.floor(result.this_time_seconds / 60);
  const secs = result.this_time_seconds % 60;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      {result.is_new_best && (
        <span className="flex items-center gap-1.5 rounded-full bg-tulsi/15 px-3 py-1 text-sm font-semibold text-tulsi-foreground">
          <Trophy className="size-4" aria-hidden />
          {t("TimeAttack.newBest")}
        </span>
      )}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-6xl">
          {result.this_correct}
          <span className="text-3xl text-muted-foreground">/{result.this_total}</span>
        </span>
        <span className="text-sm text-muted-foreground">{t("TimeAttack.correct")}</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
          <Timer className="size-4 text-primary" aria-hidden />
          {mins}:{String(secs).padStart(2, "0")}
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
          <Flame className="size-4 text-marigold" aria-hidden />
          {t("TimeAttack.bestCombo", { count: result.this_combo })}
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm">
          <Trophy className="size-4 text-marigold" aria-hidden />
          {t("TimeAttack.yourBest", { correct: result.personal_best.best_correct, total: result.personal_best.best_total })}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onAgain}>
          <Zap aria-hidden />
          {t("TimeAttack.playAgain")}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {t("TimeAttack.done")}
        </Button>
      </div>
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const locale = useLocale();
  const [start, setStart] = useState<TimeAttackStart | null>(null);
  const [result, setResult] = useState<TimeAttackResult | null>(null);
  const comboBestRef = useRef(0);
  const startTA = useStartTimeAttack();
  const finishTA = useFinishTimeAttack();

  const exit = () => navigate(`/${locale}/practice?tab=timeattack`);

  function pick(topic: { node_id: string }) {
    comboBestRef.current = 0;
    setResult(null);
    startTA.mutate(topic.node_id, { onSuccess: (data) => setStart(data) });
  }

  function reset() {
    setStart(null);
    setResult(null);
    comboBestRef.current = 0;
  }

  // Play phase.
  if (start && !result) {
    return (
      <TestPlayer
        test={start.test}
        attemptId={start.attempt_id}
        startedAt={start.started_at}
        initialAnswers={[]}
        locale={locale}
        instantFeedback
        answerKey={start.answer_key}
        autoAdvance
        bigTimer
        onComboBest={(b) => (comboBestRef.current = b)}
        onExit={exit}
        onSubmitted={() =>
          finishTA.mutate(
            { attemptId: start.attempt_id, comboBest: comboBestRef.current },
            { onSuccess: (r) => setResult(r) },
          )
        }
      />
    );
  }

  return (
    <Shell onExit={exit}>
      {result ? (
        <EndScreen result={result} onAgain={reset} onDone={exit} />
      ) : (
        <TopicPicker onPick={pick} />
      )}
    </Shell>
  );
}
