import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// UPPSC time-pressure presets: roughly 3.5 min per 125-word sub-answer, scaled up.
const PRESETS = [
  { key: "125", words: 125, minutes: 7 },
  { key: "200", words: 200, minutes: 11 },
] as const;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function WritingTimer() {
  const { t } = useTranslation();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const preset = PRESETS.find((p) => p.key === presetKey) ?? null;
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRemaining((preset?.minutes ?? 0) * 60);
    setRunning(false);
  }, [preset]);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(id);
  }, [running, remaining]);

  const low = preset !== null && remaining <= 60;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-full border border-border text-xs">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPresetKey(presetKey === p.key ? null : p.key)}
            className={cn(
              "px-2.5 py-1 font-medium transition-colors",
              presetKey === p.key ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {t("Answers.timerPreset", { words: p.words, minutes: p.minutes })}
          </button>
        ))}
      </div>

      {preset && (
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
              low ? "bg-coral/15 text-coral-foreground" : "bg-muted text-foreground",
            )}
          >
            <TimerIcon className="size-3.5" aria-hidden />
            {formatClock(remaining)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={running ? t("Answers.timerPause") : t("Answers.timerStart")}
            onClick={() => setRunning((r) => !r)}
          >
            {running ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Answers.timerReset")}
            onClick={() => {
              setRunning(false);
              setRemaining(preset.minutes * 60);
            }}
          >
            <RotateCcw aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
