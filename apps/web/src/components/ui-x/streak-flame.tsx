import { Flame } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export function StreakFlame({
  count,
  animate = false,
  className,
}: {
  count: number;
  /** Play a pop when the streak just advanced this load. */
  animate?: boolean;
  className?: string;
}) {
  const active = count > 0;
  const reduce = useReducedMotion();
  const pop = animate && !reduce;
  return (
    <motion.div
      key={pop ? `pop-${count}` : "static"}
      animate={pop ? { scale: [1, 1.3, 1] } : undefined}
      transition={{ duration: 0.6, times: [0, 0.4, 1], ease: "easeOut" }}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
        active
          ? "border-transparent bg-marigold/15 text-marigold-foreground"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      <Flame className={cn("size-4", active ? "fill-marigold text-marigold" : "text-muted-foreground")} aria-hidden />
      <span className="font-display text-sm">{count}</span>
    </motion.div>
  );
}
