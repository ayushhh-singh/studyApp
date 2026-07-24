/**
 * F6 unguided meditation timer: pick a duration, optionally mix in ambient
 * sound, a singing-bowl chime marks start and end (blueprint: "meditation
 * timers — unguided timer with singing-bowl start/end + ambient mixer").
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { SukoonExercise } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui-x/page-header";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useToolReturnTo } from "@/sukoon/lib/use-tool-return-to";
import { playSingingBowlChime } from "@/sukoon/lib/sukoon-audio-synth";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { AmbientMixer } from "@/sukoon/components/tools/ambient-mixer";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";

function formatMinutesSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function TimerPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "timer" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { config } = exercise;
  const session = useExerciseSession(exercise.id);
  const { returnTo, finish } = useToolReturnTo();

  const [minutes, setMinutes] = useState(config.default_duration_min);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (started && !running && remaining === 0 && !done) {
      setDone(true);
      playSingingBowlChime();
      session.complete(minutes * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining, started, done]);

  const start = () => {
    session.start();
    playSingingBowlChime();
    setRemaining(minutes * 60);
    setRunning(true);
    setStarted(true);
    setDone(false);
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <CompletionScreen
          title={t("Sukoon.tools.timer.doneTitle")}
          description={t("Sukoon.tools.timer.doneBody")}
          stats={[{ label: t("Sukoon.tools.stats.minutes"), value: String(minutes) }]}
          onRestart={start}
          restartLabel={t("Sukoon.tools.doAgain")}
          onDone={returnTo ? finish : () => setStarted(false)}
          doneLabel={returnTo ? t("Sukoon.tools.backToJourney") : t("Sukoon.tools.backToTools")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
      <PageHeader
        title={language === "hi" ? exercise.title_hi : exercise.title_en}
        action={
          <Link to={`${base}/tools`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            {t("Sukoon.tools.backToTools")}
          </Link>
        }
      />

      {!started ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="mb-2 text-sm font-medium text-foreground">{t("Sukoon.tools.duration")}</p>
            <div className="flex flex-wrap gap-2">
              {config.duration_options_min.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setMinutes(min)}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm transition-colors duration-300 " +
                    (minutes === min
                      ? "border-secondary bg-secondary/15 text-secondary"
                      : "border-border bg-background text-muted-foreground hover:border-secondary/40")
                  }
                >
                  {min} {t("Sukoon.tools.minutesShort")}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <AmbientMixer />
          </div>
          <Button onClick={start} size="lg">
            {t("Sukoon.tools.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="flex aspect-square w-full max-w-64 flex-col items-center justify-center gap-2 rounded-full border border-border bg-card">
            <span className="text-4xl font-bold tabular-nums text-foreground">{formatMinutesSeconds(remaining)}</span>
            <span className="text-xs text-muted-foreground">{t("Sukoon.tools.timer.remaining")}</span>
          </div>
          <Progress value={((minutes * 60 - remaining) / (minutes * 60)) * 100} className="w-full" />
          <div className="w-full rounded-2xl border border-border bg-card p-5">
            <AmbientMixer />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setRunning((r) => !r)}>
              {running ? t("Sukoon.tools.pause") : t("Sukoon.tools.resume")}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                session.complete(minutes * 60 - remaining);
                setStarted(false);
                setRunning(false);
              }}
            >
              {t("Sukoon.tools.stop")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Component() {
  return <ToolPlayerFrame type="timer">{(exercise) => <TimerPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
