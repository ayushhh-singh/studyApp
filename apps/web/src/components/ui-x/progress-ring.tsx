import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * ProgressRing — the circular "Progress Indicator" from
 * docs/design/reference-2's COMPONENTS panel (bottom right): a thick ring with
 * a warm-to-cool sweep on a quiet track and the value centred inside it.
 *
 * Deliberately NOT renamed to `ProgressIndicator`: this file already WAS the
 * app's one circular progress primitive, the design skill names it, and three
 * call sites import it. A rename would buy a synonym and cost churn — so the
 * reference's name is recorded here instead, where a grep for either term
 * lands.
 *
 * THE SWEEP IS --action -> --primary, and that pair is doing real work:
 *   - dark  gold (#F7C873) -> blue (#6E9BFF), which is literally what the
 *     reference's dark COMPONENTS panel renders.
 *   - light navy (#0B1D3B) -> blue (#1E4FD9), because the brand gold measures
 *     1.5:1 on a white card. The reference's own LIGHT dashboard (reference-1
 *     panel 6) drops the gold and renders the ring plain blue for the same
 *     reason, so this follows the reference rather than departing from it.
 * --action is already the app's one theme-inverting token and already fills
 * ProgressBar, so the linear and circular indicators stay siblings.
 *
 * The reference draws its arc starting at ~5 o'clock; that is a decorative
 * artifact of an AI-rendered mockup, not a spec. This starts at 12 and sweeps
 * clockwise, which is what a reader expects of a progress dial.
 *
 * COMPLETE renders solid --tulsi-foreground rather than the sweep, keeping the
 * "you finished it" reward the guided-today checklist has always had. It is the
 * -foreground shade, not raw --tulsi: an arc is a graphic, raw tulsi measures
 * 2.5:1 on a light card, and that is this codebase's single most-repeated
 * defect. Measured on the card: 7.7:1 light, 12:1 dark.
 */
export function ProgressRing({
  value,
  max,
  size = 56,
  stroke = 6,
  label,
  className,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  /** Announced to screen readers. Falls back to a bare percentage. */
  label?: string;
  className?: string;
  /**
   * Centred content. Sized from `size`, never a fixed text class — a hardcoded
   * one is exactly how a 30px numeral ended up inside a 56px gauge in the
   * peer-review feed.
   */
  children?: React.ReactNode;
}) {
  // React 19's useId returns ids wrapped in guillemets («r0»), and this one is
  // interpolated into an SVG `url(#…)` fragment reference rather than used as a
  // plain IDREF the way ProgressBar's is. Chromium resolves the non-ASCII form
  // fine (verified by painting both and comparing pixels), but WebKit could not
  // be tested in this environment and the failure mode is silent — an unpainted
  // arc, not an error. Stripping to [A-Za-z0-9_-] costs nothing and removes the
  // question; the suffix keeps it unique per instance.
  const gradientId = `pr-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Non-finite input must never reach strokeDashoffset — NaN there silently
  // renders no arc at all, and Infinity renders a full one. A caller dividing
  // by a nullable-numeric denominator (an evaluation's max_score can be 0) is
  // the realistic source.
  const safe = Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const pct = safe ? Math.min(1, Math.max(0, value / max)) : 0;
  const complete = safe && value >= max;
  const rounded = Math.round(pct * 100);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      // Label AND value. `label ?? pct` would have meant that passing a label
      // silently removed the number from the accessible name — a screen reader
      // would hear "Today's plan" and never learn how much of it is done, while
      // the visible numeral inside is aria-hidden to avoid a double read.
      aria-label={label ? `${label}: ${rounded}%` : `${rounded}%`}
    >
      <svg width={size} height={size} aria-hidden>
        <defs>
          {/* Top-right -> bottom-left, so the warm end sits at the 12 o'clock
              start of the sweep and cools as the value grows. A linear gradient
              cannot follow an arc; across a ring this diagonal reads as one
              continuous sweep, which is the intent. */}
          <linearGradient id={gradientId} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--action)" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--border)"
        />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{
              stroke: complete ? "var(--tulsi-foreground)" : `url(#${gradientId})`,
              transition: "stroke-dashoffset 500ms ease",
            }}
          />
        )}
      </svg>
      {children !== undefined && children !== null && (
        <span
          className="absolute inset-0 flex items-center justify-center font-display tabular-nums"
          // Scaled from `size`, and line-height stays >= 1.1 so the box is never
          // smaller than its own glyphs (the leading-none trap, twice bitten).
          style={{ fontSize: Math.round(size * 0.26), lineHeight: 1.15 }}
          aria-hidden
        >
          {children}
        </span>
      )}
    </div>
  );
}
