import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { ArrowDown, ArrowUp, Ghost, Minus, X } from "lucide-react";
import type { GhostStart } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { TestPlayer } from "@/components/practice/test-player";
import { useStartGhost } from "@/hooks/use-ghost";
import { useAttemptResult } from "@/hooks/use-attempt";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/** Cumulative per-question seconds for past-you (null pace counts as 0). */
function cumulative(ghost: GhostStart["ghost"]): number[] {
  let acc = 0;
  return ghost.map((g) => (acc += g.time_spent_seconds ?? 0));
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function GhostEndScreen({ start, newAttemptId, onAgain, onDone, raceAgainPending }: {
  start: GhostStart;
  newAttemptId: string;
  onAgain: () => void;
  onDone: () => void;
  raceAgainPending: boolean;
}) {
  const { t } = useTranslation();
  const { data: result, isLoading } = useAttemptResult(newAttemptId);

  if (isLoading || !result) return <Skeleton className="h-64 w-full rounded-xl" />;

  const ghostByQ = new Map(start.ghost.map((g) => [g.question_id, g]));
  const rows = result.review.map((r, i) => {
    const g = ghostByQ.get(r.question_id);
    return {
      index: i + 1,
      yourTime: r.time_spent_seconds,
      ghostTime: g?.time_spent_seconds ?? null,
      yourCorrect: r.is_correct,
      ghostCorrect: g?.is_correct ?? null,
    };
  });

  const yourTotal = rows.reduce((s, r) => s + (r.yourTime ?? 0), 0);
  const ghostTotal = rows.reduce((s, r) => s + (r.ghostTime ?? 0), 0);
  const yourCorrect = rows.filter((r) => r.yourCorrect === true).length;
  const ghostCorrect = rows.filter((r) => r.ghostCorrect === true).length;
  const fasterBy = ghostTotal - yourTotal; // positive = you were faster

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Ghost className="size-4" aria-hidden />
          {t("Ghost.vsPastYou")}
        </span>
        <h1 className="font-display text-3xl">
          {fasterBy > 0 ? t("Ghost.faster", { time: fmt(Math.abs(fasterBy)) })
            : fasterBy < 0 ? t("Ghost.slower", { time: fmt(Math.abs(fasterBy)) })
            : t("Ghost.tied")}
        </h1>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <span className="rounded-lg border border-border px-3 py-2">
            {t("Ghost.accuracyLine", { you: yourCorrect, past: ghostCorrect, total: rows.length })}
          </span>
          <span className="rounded-lg border border-border px-3 py-2">
            {t("Ghost.timeLine", { you: fmt(yourTotal), past: fmt(ghostTotal) })}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="p-2 text-start font-medium">{t("Ghost.colQ")}</th>
              <th className="p-2 text-end font-medium">{t("Ghost.colYou")}</th>
              <th className="p-2 text-end font-medium">{t("Ghost.colPast")}</th>
              <th className="p-2 text-end font-medium">{t("Ghost.colDelta")}</th>
              <th className="p-2 text-center font-medium">{t("Ghost.colResult")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.yourTime != null && r.ghostTime != null ? r.ghostTime - r.yourTime : null;
              return (
                <tr key={r.index} className="border-t border-border">
                  <td className="p-2 tabular-nums">{r.index}</td>
                  <td className="p-2 text-end tabular-nums">{r.yourTime != null ? `${r.yourTime}s` : "—"}</td>
                  <td className="p-2 text-end tabular-nums text-muted-foreground">{r.ghostTime != null ? `${r.ghostTime}s` : "—"}</td>
                  <td className={cn("p-2 text-end tabular-nums", delta != null && (delta > 0 ? "text-tulsi-foreground" : delta < 0 ? "text-coral-foreground" : ""))}>
                    <span className="inline-flex items-center gap-0.5">
                      {delta == null ? "—" : delta > 0 ? <ArrowDown className="size-3" aria-hidden /> : delta < 0 ? <ArrowUp className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
                      {delta != null ? `${Math.abs(delta)}s` : ""}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <span className={cn("inline-block size-2.5 rounded-full", r.yourCorrect ? "bg-tulsi" : r.yourCorrect === false ? "bg-coral" : "bg-muted-foreground")} title={r.yourCorrect ? t("Ghost.correct") : t("Ghost.incorrect")} />
                    {r.ghostCorrect !== r.yourCorrect && r.yourCorrect === true && (
                      <span className="ms-1 text-xs text-tulsi-foreground">{t("Ghost.newlyRight")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onAgain} disabled={raceAgainPending}>
          <Ghost aria-hidden />
          {t("Ghost.raceAgain")}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={raceAgainPending}>{t("Ghost.viewResult")}</Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">{t("Ghost.masteryNote")}</p>
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const { attemptId = "" } = useParams<{ attemptId: string }>();
  const startGhost = useStartGhost();
  const [start, setStart] = useState<GhostStart | null>(null);
  const [finishedAttemptId, setFinishedAttemptId] = useState<string | null>(null);

  useEffect(() => {
    if (attemptId) startGhost.mutate(attemptId, { onSuccess: setStart });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const cumSeconds = useMemo(() => (start ? cumulative(start.ghost) : []), [start]);
  const backToResult = () => navigate(`/${locale}/practice/attempt/${attemptId}/result`);

  function raceAgain() {
    if (startGhost.isPending) return;
    setStart(null);
    setFinishedAttemptId(null);
    startGhost.mutate(attemptId, { onSuccess: setStart });
  }

  if (startGhost.isError) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <EmptyState
          icon={Ghost}
          title={t("Ghost.errorTitle")}
          description={t("Ghost.errorDescription")}
          action={<Button onClick={backToResult}>{t("Ghost.viewResult")}</Button>}
        />
      </div>
    );
  }

  // Play phase.
  if (start && !finishedAttemptId) {
    return (
      <TestPlayer
        test={start.test}
        attemptId={start.attempt_id}
        startedAt={start.started_at}
        initialAnswers={[]}
        locale={locale}
        ghost={{ cumulativeSeconds: cumSeconds }}
        onExit={backToResult}
        onSubmitted={(r) => setFinishedAttemptId(r.attempt.id)}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={backToResult} aria-label={t("Practice.exit")}>
          <X aria-hidden />
        </Button>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Ghost className="size-4 text-primary" aria-hidden />
          {t("Ghost.title")}
        </span>
      </header>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
        {start && finishedAttemptId ? (
          <GhostEndScreen
            start={start}
            newAttemptId={finishedAttemptId}
            onAgain={raceAgain}
            onDone={backToResult}
            raceAgainPending={startGhost.isPending}
          />
        ) : (
          <Skeleton className="h-64 w-full rounded-xl" />
        )}
      </div>
    </div>
  );
}
