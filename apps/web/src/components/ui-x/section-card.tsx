import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // min-w-0: a grid/flex item's default min-width is `auto`, which lets its
    // content (e.g. a recharts ResponsiveContainer's initial ResizeObserver
    // measurement, which can race ahead of layout settling) force the whole
    // track wider than the grid intended — the classic "grid item won't
    // shrink" bug. Confirmed live: the dashboard's 2fr/1fr performance-card
    // grid overflowed the 390px viewport in Hindi (longer sibling text
    // apparently made the race more reliable) until this was added.
    <section
      className={cn("flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm", className)}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
