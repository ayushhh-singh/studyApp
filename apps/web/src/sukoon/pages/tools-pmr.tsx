/**
 * F6 Progressive Muscle Relaxation. When the operator has uploaded
 * pre-rendered audio for the current language, it plays through the custom
 * AudioPlayer (same as guided meditations); otherwise the segment list itself
 * drives a text/visual-guided timer that auto-advances (blueprint: "PMR —
 * guided progressive muscle relaxation with pre-rendered Hindi audio", with a
 * text fallback so the tool is never blocked on the recording being done).
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { SukoonExercise } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui-x/page-header";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useResolvedAudioSrc } from "@/sukoon/lib/use-resolved-audio-src";
import { useToolReturnTo } from "@/sukoon/lib/use-tool-return-to";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { AudioPlayer } from "@/sukoon/components/tools/audio-player";
import { PinAudioButton } from "@/sukoon/components/tools/pin-audio-button";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";

interface PmrState {
  idx: number;
  remaining: number;
  running: boolean;
  done: boolean;
}

function TextGuidedPmr({ exercise }: { exercise: Extract<SukoonExercise, { type: "pmr" }> }) {
  const { t, language } = useSukoonLanguage();
  const { segments } = exercise.config;
  const session = useExerciseSession(exercise.id);
  const { returnTo, finish } = useToolReturnTo();
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<PmrState>({
    idx: 0,
    remaining: segments[0]?.seconds ?? 0,
    running: false,
    done: false,
  });

  // Pure state transitions in the tick — no side effects inside the updater
  // (React/StrictMode may invoke it more than once), so `session.complete` is
  // fired from the effect below, keyed on the `done` transition instead.
  useEffect(() => {
    if (!state.running) return;
    const interval = setInterval(() => {
      setState((prev) => {
        if (prev.remaining > 1) return { ...prev, remaining: prev.remaining - 1 };
        const next = prev.idx + 1;
        if (next >= segments.length) return { ...prev, running: false, done: true };
        return { idx: next, remaining: segments[next].seconds, running: true, done: false };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [state.running, segments]);

  useEffect(() => {
    if (state.done) session.complete(segments.reduce((s, seg) => s + seg.seconds, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  const start = () => {
    session.start();
    setStarted(true);
    setState({ idx: 0, remaining: segments[0]?.seconds ?? 0, running: true, done: false });
  };

  if (state.done) {
    return (
      <CompletionScreen
        title={t("Sukoon.tools.pmr.doneTitle")}
        description={t("Sukoon.tools.pmr.doneBody")}
        onRestart={start}
        restartLabel={t("Sukoon.tools.doAgain")}
        onDone={returnTo ? finish : () => setStarted(false)}
        doneLabel={returnTo ? t("Sukoon.tools.backToJourney") : t("Sukoon.tools.backToTools")}
      />
    );
  }

  if (!started) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{t("Sukoon.tools.pmr.intro")}</p>
        <ol className="flex flex-col gap-1.5 text-sm text-foreground">
          {segments.map((seg) => (
            <li key={seg.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5">
              <span>{language === "hi" ? seg.name_hi : seg.name_en}</span>
              <span className="text-xs text-muted-foreground">{seg.seconds}s</span>
            </li>
          ))}
        </ol>
        <Button onClick={start} size="lg">
          {t("Sukoon.tools.start")}
        </Button>
      </div>
    );
  }

  const segment = segments[state.idx];
  const progressPct = segment ? ((segment.seconds - state.remaining) / segment.seconds) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 text-center">
      <p className="text-xs font-medium text-muted-foreground">
        {t("Sukoon.tools.pmr.segmentProgress", { current: state.idx + 1, total: segments.length })}
      </p>
      <h3 className="text-2xl font-bold text-foreground">{segment ? (language === "hi" ? segment.name_hi : segment.name_en) : ""}</h3>
      <span className="text-3xl font-bold tabular-nums text-secondary">{state.remaining}</span>
      <Progress value={progressPct} className="w-full" />
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => setState((prev) => ({ ...prev, running: !prev.running }))}>
          {state.running ? t("Sukoon.tools.pause") : t("Sukoon.tools.resume")}
        </Button>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            const elapsed =
              (segments[state.idx]?.seconds ?? 0) -
              state.remaining +
              segments.slice(0, state.idx).reduce((s, seg) => s + seg.seconds, 0);
            session.complete(elapsed);
            setStarted(false);
            setState({ idx: 0, remaining: segments[0]?.seconds ?? 0, running: false, done: false });
          }}
        >
          {t("Sukoon.tools.stop")}
        </Button>
      </div>
    </div>
  );
}

function AudioGuidedPmr({
  exercise,
  hasAudio,
}: {
  exercise: Extract<SukoonExercise, { type: "pmr" }>;
  hasAudio: boolean;
}) {
  const { language } = useSukoonLanguage();
  const title = language === "hi" ? exercise.title_hi : exercise.title_en;
  const session = useExerciseSession(exercise.id);
  const resolved = useResolvedAudioSrc(exercise.id, language, hasAudio);
  const { finish } = useToolReturnTo();
  const [started, setStarted] = useState(false);

  if (resolved.status !== "ready") {
    return <TextGuidedPmr exercise={exercise} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <AudioPlayer
        src={resolved.src}
        title={title}
        onPlay={() => {
          if (started) return;
          setStarted(true);
          session.start();
        }}
        onEnded={() => {
          session.complete(exercise.config.segments.reduce((s, seg) => s + seg.seconds, 0));
          finish();
        }}
      />
      <div className="flex justify-center">
        <PinAudioButton exerciseId={exercise.id} lang={language} label={title} signedUrl={resolved.signedUrl} />
      </div>
    </div>
  );
}

function PmrPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "pmr" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const hasAudio = language === "hi" ? exercise.has_audio_hi : exercise.has_audio_en;

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
      {hasAudio ? <AudioGuidedPmr exercise={exercise} hasAudio={hasAudio} /> : <TextGuidedPmr exercise={exercise} />}
    </div>
  );
}

export function Component() {
  return <ToolPlayerFrame type="pmr">{(exercise) => <PmrPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
