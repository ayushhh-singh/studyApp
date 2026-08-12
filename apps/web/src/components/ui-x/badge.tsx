import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — the two variants in docs/design/reference-3's BUTTONS & COMPONENTS
 * panel: "New" (brand blue) and "Hot" (red). A small non-interactive status
 * pill, distinct from Chip, which is a control.
 *
 * Each variant carries an explicit text colour rather than inheriting, because
 * both fills change between themes and the safe text colour flips with them:
 *   new — bg is --primary, which lightens in dark, so its paired
 *         --primary-foreground flips white -> navy with it (6.6:1 / 7.1:1).
 *   hot — bg is --destructive. White clears 4.5:1 on the light red (4.8:1) but
 *         only manages 3.0:1 on the lighter dark-theme red, so dark switches to
 *         navy text (5.6:1) instead of quietly failing.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        new: "bg-primary text-primary-foreground",
        hot: "bg-destructive text-white dark:text-brand-navy",
      },
    },
    defaultVariants: { variant: "new" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { badgeVariants };
