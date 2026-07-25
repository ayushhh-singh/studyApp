import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JoyBadge } from "@/sukoon/components/sukoon-celebrate";

/**
 * The shared completion screen every F6 player (and a completed journey) ends
 * on. This is a genuine POSITIVE moment, so it carries the warm "joy" accent:
 * a coral→apricot medallion with a soft breathing glow, easing open with a
 * slow bloom + a gentle rise of the copy beneath it. Deliberately warm-and-
 * calm, NOT confetti/streak-guilt — a wellness completion should feel like an
 * exhale you earned. (Contrast the CALM check-in/mood/crisis surfaces, which
 * never take this accent — see docs/sukoon-design.md.)
 */
export function CompletionScreen({
  title,
  description,
  stats,
  onRestart,
  onDone,
  restartLabel,
  doneLabel,
}: {
  title: string;
  description?: string;
  stats?: { label: string; value: string }[];
  onRestart?: () => void;
  onDone: () => void;
  restartLabel?: string;
  doneLabel: string;
}) {
  return (
    <div className="relative mx-auto flex max-w-sm flex-col items-center gap-6 overflow-hidden rounded-3xl px-6 py-12 text-center sukoon-joy-wash">
      <JoyBadge icon={CheckCircle2} size="lg" />

      <div className="space-y-1.5 sukoon-rise">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>

      {stats && stats.length > 0 ? (
        <div className="flex gap-8 sukoon-rise-slow">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-0.5">
              <span
                className="text-2xl font-extrabold tabular-nums tracking-tight"
                style={{ color: "var(--sukoon-joy-strong)" }}
              >
                {s.value}
              </span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 sukoon-rise-slow">
        {onRestart ? (
          <Button variant="outline" className="min-h-11" onClick={onRestart}>
            {restartLabel}
          </Button>
        ) : null}
        <Button className="min-h-11" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
