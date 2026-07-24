/**
 * F10 Voice Mode's minutes-left meter — a ring that visually depletes as the
 * month's 60 minutes are used, reusing F7's ProgressRing (Sukoon's one
 * existing ring primitive) rather than a second hand-rolled SVG. The number
 * and label turn coral at the 50-minute warning threshold (blueprint:
 * "warning payload at 50 min"), matching how the rest of Sukoon reserves
 * coral for a gentle caution, never an alarm — the ring itself stays the
 * calm secondary color (ProgressRing has no color prop, and reaching into its
 * internal class names would couple this component to an implementation
 * detail of a shared primitive).
 */
import { cn } from "@/lib/utils";
import { ProgressRing } from "@/sukoon/components/journeys/progress-ring";

export function VoiceMeterRing({
  remainingSeconds,
  limitSeconds,
  warning,
  label,
}: {
  remainingSeconds: number;
  limitSeconds: number;
  warning: boolean;
  label: string;
}) {
  const pct = limitSeconds > 0 ? (remainingSeconds / limitSeconds) * 100 : 0;
  const minutesLeft = Math.ceil(remainingSeconds / 60);

  return (
    <div className="flex items-center gap-2.5" role="status" aria-label={label}>
      <div className="relative flex items-center justify-center">
        <ProgressRing value={pct} size={40} strokeWidth={3.5} />
        <span
          className={cn(
            "absolute text-[10px] font-semibold tabular-nums",
            warning ? "text-destructive" : "text-secondary",
          )}
        >
          {minutesLeft}
        </span>
      </div>
      <span className={cn("text-xs leading-tight text-muted-foreground", warning && "text-destructive")}>
        {label}
      </span>
    </div>
  );
}
