import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
  tourAnchor,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Guided-tab-tour stop key — see GuidedTourCoachmark, which spotlights this element by selector. */
  tourAnchor?: string;
}) {
  return (
    <div
      data-tour-anchor={tourAnchor}
      className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm whitespace-pre-line text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
