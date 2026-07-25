/**
 * F6 breathing player: animated circle synced to inhale/hold/exhale/hold
 * phases, Vibration-API haptics on phase change, an optional quiet ambient
 * bed, and a configurable session length (blueprint: "1/3/5/10 min").
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Link } from "react-router";
import type { SukoonBreathPhase, SukoonExercise } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui-x/page-header";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { breathHapticFor, hapticsSupported, stopVibration, vibrate } from "@/sukoon/lib/sukoon-haptics";
import { playBreathCue } from "@/sukoon/lib/sukoon-audio-cues";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useAmbientChannel } from "@/sukoon/lib/use-ambient-channel";
import { useToolReturnTo } from "@/sukoon/lib/use-tool-return-to";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { BreathingCircle } from "@/sukoon/components/tools/breathing-circle";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";

const DURATION_PRESETS_MIN = [1, 3, 5, 10];

interface ActivePhase extends SukoonBreathPhase {
  haptics: number;
}

interface PlayerState {
  phaseIdx: number;
  cycle: number;
  remaining: number;
  running: boolean;
  done: boolean;
}

function targetScaleFor(phaseId: string, prevScale: number): number {
  if (phaseId === "inhale") return 1;
  if (phaseId === "exhale") return 0.55;
  return prevScale; // holds keep whatever scale they arrived at
}

function BreathingPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "breathing" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { config } = exercise;

  const activePhases = useMemo<ActivePhase[]>(
    () =>
      config.phases
        .map((p, i) => ({ ...p, haptics: config.haptics_pattern_ms[i] ?? 0 }))
        .filter((p) => p.seconds > 0),
    [config],
  );
  const cycleSeconds = useMemo(() => activePhases.reduce((sum, p) => sum + p.seconds, 0), [activePhases]);

  const [totalCycles, setTotalCycles] = useState(config.default_cycles);
  const [ambientOn, setAmbientOn] = useState(false);
  // Haptics are an ENHANCEMENT (see sukoon-haptics.ts) — only offer the toggle
  // where the platform could actually honour it (Android/Chrome), so an iPhone
  // user is never shown a switch that silently does nothing. Default on.
  const hapticsAvail = useMemo(() => hapticsSupported(), []);
  const [hapticsOn, setHapticsOn] = useState(true);
  // Soft audio cues per phase. Default OFF (opt-in) — aspirants often practise
  // in a shared/quiet space, so sound must never start unprompted.
  const [cuesOn, setCuesOn] = useState(false);
  const [scale, setScale] = useState(0.55);
  const [state, setState] = useState<PlayerState>({
    phaseIdx: 0,
    cycle: 1,
    remaining: activePhases[0]?.seconds ?? 0,
    running: false,
    done: false,
  });

  const session = useExerciseSession(exercise.id);
  const { returnTo, finish } = useToolReturnTo();
  useAmbientChannel(config.default_ambient ?? "rain", ambientOn && !!config.default_ambient, 0.3);

  useEffect(() => {
    if (!state.running) return;
    const interval = setInterval(() => {
      setState((prev) => {
        if (prev.remaining > 1) return { ...prev, remaining: prev.remaining - 1 };
        const nextIdx = (prev.phaseIdx + 1) % activePhases.length;
        const wrapped = nextIdx === 0;
        const nextCycle = wrapped ? prev.cycle + 1 : prev.cycle;
        if (wrapped && prev.cycle >= totalCycles) {
          return { ...prev, running: false, done: true };
        }
        return { phaseIdx: nextIdx, cycle: nextCycle, remaining: activePhases[nextIdx]?.seconds ?? 0, running: true, done: false };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [state.running, activePhases, totalCycles]);

  // Fires on every phase change (incl. the very first, since `running` flips
  // true while phaseIdx is still 0) — the visual scale target + a vibration.
  useEffect(() => {
    if (!state.running) return;
    const phase = activePhases[state.phaseIdx];
    if (!phase) return;
    setScale((prev) => targetScaleFor(phase.id, prev));
    // Distinct texture per phase (rising taps to inhale, one long soft buzz to
    // exhale) via the shared util — feature-detected + swallow-throwing inside.
    if (hapticsOn) vibrate(breathHapticFor(phase.id, phase.haptics));
    // A soft paced audio cue (real bundled file, synth fallback) — rising for
    // inhale, falling for exhale, a gentle tap for either hold.
    if (cuesOn) playBreathCue(phase.id === "inhale" ? "inhale" : phase.id === "exhale" ? "exhale" : "hold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phaseIdx, state.running, hapticsOn, cuesOn]);

  useEffect(() => {
    if (state.done) session.complete(totalCycles * cycleSeconds);
  }, [state.done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never leave a vibration running past the player (pause handled below).
  useEffect(() => () => stopVibration(), []);

  const start = () => {
    session.start();
    setScale(0.55);
    setState({ phaseIdx: 0, cycle: 1, remaining: activePhases[0]?.seconds ?? 0, running: true, done: false });
  };
  const pause = () => {
    stopVibration();
    setState((prev) => ({ ...prev, running: false }));
  };
  const resume = () => setState((prev) => ({ ...prev, running: true }));
  const restart = () => {
    setAmbientOn(false);
    start();
  };

  if (state.done) {
    return (
      <div className="mx-auto max-w-lg">
        <CompletionScreen
          title={t("Sukoon.tools.breathing.doneTitle")}
          description={t("Sukoon.tools.breathing.doneBody")}
          stats={[
            { label: t("Sukoon.tools.stats.cycles"), value: String(totalCycles) },
            { label: t("Sukoon.tools.stats.minutes"), value: String(Math.round((totalCycles * cycleSeconds) / 60)) },
          ]}
          onRestart={restart}
          restartLabel={t("Sukoon.tools.doAgain")}
          onDone={
            returnTo
              ? finish
              : () => setState({ phaseIdx: 0, cycle: 1, remaining: activePhases[0]?.seconds ?? 0, running: false, done: false })
          }
          doneLabel={returnTo ? t("Sukoon.tools.backToJourney") : t("Sukoon.tools.backToTools")}
        />
      </div>
    );
  }

  const isActive = state.running || state.remaining !== (activePhases[0]?.seconds ?? 0) || state.cycle > 1;

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

      {!isActive ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t("Sukoon.tools.duration")}</p>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS_MIN.map((min) => {
                const cycles = Math.max(1, Math.round((min * 60) / cycleSeconds));
                const active = cycles === totalCycles;
                return (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setTotalCycles(cycles)}
                    className={
                      "rounded-full border px-3 py-1.5 text-sm transition-colors duration-300 " +
                      (active
                        ? "border-secondary bg-secondary/15 text-secondary"
                        : "border-border bg-background text-muted-foreground hover:border-secondary/40")
                    }
                  >
                    {min} {t("Sukoon.tools.minutesShort")}
                  </button>
                );
              })}
            </div>
          </div>
          {config.default_ambient ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("Sukoon.tools.playBackgroundSound")}</span>
              <Switch checked={ambientOn} onCheckedChange={setAmbientOn} />
            </div>
          ) : null}
          {/* Only shown where the device can actually vibrate (Android/Chrome) —
              hidden on iOS/desktop rather than offering a switch that lies. */}
          {hapticsAvail ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{t("Sukoon.tools.breathing.haptics")}</span>
                <span className="text-xs text-muted-foreground">{t("Sukoon.tools.breathing.hapticsSub")}</span>
              </span>
              <Switch
                checked={hapticsOn}
                onCheckedChange={setHapticsOn}
                aria-label={t("Sukoon.tools.breathing.haptics")}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-sm text-foreground">{t("Sukoon.tools.breathing.soundCues")}</span>
              <span className="text-xs text-muted-foreground">{t("Sukoon.tools.breathing.soundCuesSub")}</span>
            </span>
            <Switch
              checked={cuesOn}
              onCheckedChange={setCuesOn}
              aria-label={t("Sukoon.tools.breathing.soundCues")}
            />
          </div>
          <Button onClick={start} size="lg" className="min-h-11">
            {t("Sukoon.tools.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <BreathingCircle
            targetScale={scale}
            seconds={activePhases[state.phaseIdx]?.seconds ?? 1}
            label={t(`Sukoon.tools.breathing.phase.${activePhases[state.phaseIdx]?.id ?? "inhale"}`)}
            seconds_remaining={state.remaining}
          />
          <p className="text-sm text-muted-foreground">
            {t("Sukoon.tools.breathing.cycleProgress", { current: state.cycle, total: totalCycles })}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" className="min-h-11" onClick={state.running ? pause : resume}>
              {state.running ? t("Sukoon.tools.pause") : t("Sukoon.tools.resume")}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 text-destructive hover:text-destructive"
              onClick={() => {
                stopVibration();
                // Full completed cycles + progress within the current
                // (incomplete) one — a Stop mid-phase previously reported 0s
                // for the whole in-progress cycle, undercounting real elapsed time.
                const inCurrentCycle =
                  activePhases.slice(0, state.phaseIdx).reduce((sum, p) => sum + p.seconds, 0) +
                  ((activePhases[state.phaseIdx]?.seconds ?? 0) - state.remaining);
                session.complete(cycleSeconds * (state.cycle - 1) + inCurrentCycle);
                setState({ phaseIdx: 0, cycle: 1, remaining: activePhases[0]?.seconds ?? 0, running: false, done: false });
                setAmbientOn(false);
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
  return <ToolPlayerFrame type="breathing">{(exercise) => <BreathingPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
