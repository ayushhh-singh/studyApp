import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { cn } from "@/lib/utils";

interface TimerPreset {
  key: string;
  words: number;
  minutes: number;
}

/**
 * Time-pressure presets, PER EXAM and authored per exam.
 *
 * These are not derivable from `exams.paper_structure`: it carries a paper's
 * total marks and duration, never the per-question word limits a commission's
 * papers actually use, nor the pace an aspirant should train at. Both are
 * judgment about a specific commission's papers — exactly the category
 * `lib/exam-config.ts` refuses to template by string-replacing the exam name.
 *
 * So this mirrors that module's UNAUTHORED convention on the client: uppsc's
 * values are the ones this app has always shipped (~3.5 min per 125-word
 * sub-answer, scaled up); the other exams have no entry, and an exam with no
 * entry gets NO presets rather than UPPSC's borrowed numbers. Authoring them is
 * part of per-exam content work (U6 — docs/OUTSTANDING.md §8).
 */
const PRESETS_BY_EXAM: Record<string, TimerPreset[]> = {
  uppsc: [
    { key: "125", words: 125, minutes: 7 },
    { key: "200", words: 200, minutes: 11 },
  ],
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function WritingTimer() {
  const { t } = useTranslation();
  const { examCode } = useCurrentExam();
  const presets = PRESETS_BY_EXAM[examCode] ?? [];
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const preset = presets.find((p) => p.key === presetKey) ?? null;
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

  // No authored presets for this exam — render nothing rather than offering
  // another commission's word limits and pace as if they were this one's.
  if (presets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-full border border-border text-xs">
        {presets.map((p) => (
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
