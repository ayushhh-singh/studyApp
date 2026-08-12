import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * StatCard — the stat tile from docs/design/reference-1's dashboard (panel 6)
 * and "Your Performance" strip (panel 5): a muted label, a large display
 * numeral, a muted caption, and the icon as a soft tinted badge on the right.
 *
 * The icon used to sit inline with the label at muted-foreground; the reference
 * gives it its own tinted square, which is what makes a row of these read as
 * tiles rather than as paragraphs.
 *
 * `tone` colours the numeral only. `accent` is --marigold-FOREGROUND, never raw
 * --marigold: the brand gold is 1.6:1 on a light card and this is text. The
 * paired shade measures 8.0:1 light and 11:1 dark.
 */
const TONE_CLASS = {
  default: "text-card-foreground",
  accent: "text-marigold-foreground",
  primary: "text-primary",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  leading,
  pop = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  /** Colours the numeral. `accent` is the reference's gold streak count. */
  tone?: keyof typeof TONE_CLASS;
  /** Rendered before the text block — the reference puts a ProgressRing here. */
  leading?: ReactNode;
  /**
   * Play a one-shot pop on the icon badge. Carries Session 15's streak-advance
   * reward, which used to live on the dashboard greeting's StreakFlame and was
   * orphaned when that flame was removed as a duplicate — `streak_incremented
   * _today` is on the payload for exactly this and had no consumer left.
   */
  pop?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const playing = pop && !reduce;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm",
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-muted-foreground">{label}</span>
        {/* No leading-none — at this size a 1.0 line box is shorter than the
            glyphs (2cf046a). font-display is Inter 800 tabular; Poppins has no
            tabular figures and must never carry counting digits. */}
        <span className={cn("font-display text-3xl", TONE_CLASS[tone])}>{value}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      {Icon && (
        <motion.span
          // Same shape as StreakFlame's pop (scale 1 -> 1.3 -> 1, 0.6s), so the
          // reward reads identically to the chip it replaced.
          key={playing ? "pop" : "static"}
          animate={playing ? { scale: [1, 1.3, 1] } : undefined}
          transition={{ duration: 0.6, times: [0, 0.4, 1], ease: "easeOut" }}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            tone === "accent" ? "bg-marigold/20 text-marigold-foreground" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </motion.span>
      )}
    </div>
  );
}
