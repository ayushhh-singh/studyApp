import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * ProgressBar — the "Progress Bar" row from docs/design/reference-3's
 * BUTTONS & COMPONENTS panel: a label, a rounded track with a filled portion
 * and a knob at the leading edge, and the percentage above-right.
 *
 * The linear counterpart to the existing ProgressRing (used where a ring is
 * too heavy, e.g. inside a course/chapter row). The fill is --action, so it is
 * navy in light and gold in dark — which is exactly what reference-2 shows on
 * its light and dark COMPONENTS panels respectively.
 *
 * Rendered as a real ARIA progressbar rather than two divs, so a screen reader
 * announces the value; the visible percentage is aria-hidden to avoid it being
 * read twice.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  knob = true,
  className,
}: {
  value: number;
  max?: number;
  /** Optional leading label, rendered on the same row as the track. */
  label?: string;
  showValue?: boolean;
  /** The reference's dot at the leading edge of the fill. Hide it in dense rows. */
  knob?: boolean;
  className?: string;
}) {
  const id = useId();
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const rounded = Math.round(pct);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-2">
          {label ? (
            <span id={id} className="truncate text-sm font-medium">
              {label}
            </span>
          ) : (
            <span />
          )}
          {showValue && (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground" aria-hidden>
              {rounded}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-labelledby={label ? id : undefined}
        aria-label={label ? undefined : `${rounded}%`}
        className="relative h-2 w-full rounded-full bg-muted"
      >
        <div
          className="absolute inset-y-0 start-0 rounded-full bg-action transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
        {knob && pct > 0 && (
          // -translate-x-1/2 is intentionally NOT logical (no RTL variant): the
          // knob is centred on the fill's leading edge, and `start`/`width`
          // above already flip with direction, so the visual centring offset is
          // the same sign either way.
          <span
            className="absolute top-1/2 size-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-background bg-action transition-[inset-inline-start] duration-500"
            style={{ insetInlineStart: `${pct}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
