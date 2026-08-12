import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Chip — the "Chip Active / Chip Inactive" pair from docs/design/reference-3's
 * BUTTONS & COMPONENTS panel. A filter/segment control that is more rounded
 * and lighter-weight than a Button, for sets where several may be on at once
 * (category filters, paper pickers).
 *
 * Active reuses --action, so it is navy in light and gold in dark exactly like
 * the primary button. Inactive is the pale --secondary fill.
 *
 * The inactive label is --secondary-foreground at 80%, NOT --muted-foreground:
 * the reference's own pale-chip/grey-label pairing measures 4.1:1, under the
 * 4.5:1 floor for text this size. 80% of the navy foreground measures 7.9:1 in
 * light and 7.9:1 in dark while still reading clearly quieter than the filled
 * active chip, whose contrast comes from the fill rather than the label.
 */
export function Chip({
  active = false,
  className,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="chip"
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm whitespace-nowrap transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        active
          ? "bg-action font-semibold text-action-foreground"
          : "bg-secondary font-medium text-secondary-foreground/80 hover:bg-secondary/70 hover:text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}
