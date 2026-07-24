import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The shared "calm completion screen" every F6 player ends on — deliberately
 *  plain (a checkmark + a couple of stats), no gamified confetti/streak-guilt. */
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
    <div className="mx-auto flex max-w-sm flex-col items-center gap-5 py-10 text-center">
      <span
        className="flex size-16 items-center justify-center rounded-full bg-secondary/15 text-secondary"
        aria-hidden
      >
        <CheckCircle2 className="size-9" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {stats && stats.length > 0 ? (
        <div className="flex gap-6">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col items-center">
              <span className="text-lg font-semibold text-foreground">{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex gap-3">
        {onRestart ? (
          <Button variant="outline" onClick={onRestart}>
            {restartLabel}
          </Button>
        ) : null}
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}
