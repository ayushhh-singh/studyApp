/**
 * Sukoon celebration primitives — the ONLY place the warm "joy" accent
 * (coral→apricot gradient + ambient glow) is rendered. Reserve these for
 * genuinely POSITIVE moments (exercise completion, an active journaling
 * streak, a voice-session end, milestones). Never render them on a check-in,
 * mood log, difficult journal entry, or any crisis-adjacent surface — the
 * calm indigo/teal/sand layer owns those. See docs/sukoon-design.md and the
 * header note in theme/index.css.
 *
 * The vibrancy here is deliberately warm-and-alive, not gamified: a slow
 * bloom + a breathing-paced glow, not a confetti burst. All motion is driven
 * by `animation` keyframes, so the global prefers-reduced-motion rule
 * neutralises it with no extra guard.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <JoyGlow/> — a decorative warm ambient-light layer. Position it absolutely
 * behind a positive moment's content (the parent must be `relative` and
 * usually `overflow-hidden`). Purely decorative → aria-hidden, never announced.
 */
export function JoyGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 sukoon-joy-glow sukoon-glow-breathe",
        className,
      )}
    />
  );
}

/**
 * <JoyBadge/> — the celebratory medallion: a warm coral→apricot gradient ring
 * with a soft breathing glow and a bloom-in on mount, wrapping one icon. The
 * icon inherits `--sukoon-joy-foreground` (white on the gradient), and the
 * glow sits behind it. Size is the ring diameter in rem-ish tailwind units.
 */
export function JoyBadge({
  icon: Icon,
  size = "lg",
  className,
}: {
  icon: LucideIcon;
  size?: "md" | "lg";
  className?: string;
}) {
  const ring = size === "lg" ? "size-20" : "size-14";
  const glyph = size === "lg" ? "size-10" : "size-7";
  return (
    <span className={cn("relative inline-flex items-center justify-center", className)} aria-hidden>
      {/* Ambient glow, larger than the ring, breathing slowly. */}
      <span className="pointer-events-none absolute -inset-6 sukoon-joy-glow sukoon-glow-breathe" />
      <span
        className={cn(
          "relative flex items-center justify-center rounded-full shadow-sm sukoon-joy-gradient sukoon-bloom",
          ring,
        )}
        style={{ color: "var(--sukoon-joy-foreground)" }}
      >
        <Icon className={glyph} />
      </span>
    </span>
  );
}
