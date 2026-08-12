import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * InfoCard — the "Info Card" tile from docs/design/reference-3's BUTTONS &
 * COMPONENTS panel: a small icon + muted eyebrow on one row, then a bold
 * heading and a muted description.
 *
 * Deliberately NOT a variant of SectionCard: that one is a page-level section
 * (h2 title, action slot, 20px padding, own border) and this is a compact tile
 * meant to sit several-across inside one. The reference uses both, side by
 * side, on the same screens.
 *
 * `as` keeps the heading level honest — an InfoCard inside a SectionCard's
 * <h2> section should render <h3>, and one used purely decoratively can drop
 * to a <p> so it never lands in the document outline.
 */
export function InfoCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  as: Heading = "h3",
  action,
  className,
}: {
  icon?: LucideIcon;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  as?: "h2" | "h3" | "h4" | "p";
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors",
        className,
      )}
    >
      {(Icon || eyebrow) && (
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
          {eyebrow && (
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{eyebrow}</span>
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading className={cn("min-w-0 text-base font-semibold", Heading === "p" && "font-heading")}>
          {title}
        </Heading>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
