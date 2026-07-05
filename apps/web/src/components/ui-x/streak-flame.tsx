import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export function StreakFlame({ count, className }: { count: number; className?: string }) {
  const active = count > 0;
  return (
    <div
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
    </div>
  );
}
