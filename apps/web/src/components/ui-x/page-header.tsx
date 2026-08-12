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
      <div className="flex min-w-0 flex-col gap-1">
        {/* break-words: title is untrusted dynamic content in several callers
            (a syllabus node/paper title, a test title, a display name up to
            120 chars with no space requirement) — a single unbreakable "word"
            wider than the container overflows the whole PAGE horizontally
            otherwise (confirmed: identical overflow with or without this
            session's shrink-0 fix, since text overflow here is independent of
            the sibling action's flex-shrink settings). break-words only ever
            activates once normal space-based wrapping is exhausted, so a
            real multi-word title is unaffected — text-balance still drives
            the common case. */}
        <h1 className="text-2xl font-bold tracking-tight text-balance break-words">{title}</h1>
        {description && <p className="text-sm whitespace-pre-line text-muted-foreground">{description}</p>}
      </div>
      {/* No shrink-0: an action that's itself a `flex flex-wrap` row of several
          chips (GreetingHeader's trial/exam countdown pills) needs the freedom
          to shrink so its OWN wrap can kick in — shrink-0 forced it to keep its
          full unwrapped width and overflow the page instead, right at the
          sm:/md: breakpoints where the row layout has the least room (real
          bug, reproduced 640-680px and 768-950px). Deliberately no min-w-0
          here (unlike the title block above): the default min-width:auto
          floors this at its widest single chip's own width, which is exactly
          "wrap to one chip per line" — min-w-0 would let it shrink past that
          and clip a chip's own text instead. Every other action= caller in the
          app is a single button/link/select with no internal wrap points, so
          its own min-content floor is unchanged by this. */}
      {action && <div>{action}</div>}
    </div>
  );
}
