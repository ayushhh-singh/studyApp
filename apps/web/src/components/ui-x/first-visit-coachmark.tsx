import { useState, type RefObject } from "react";
import type { TourSectionKey } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { SpotlightFrame, useSpotlightRect } from "@/components/ui-x/spotlight";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";

const MAX_MESSAGE_CHARS = 140;

interface FirstVisitCoachmarkProps {
  /** Which sub-feature this fires for — persisted so it never fires twice. */
  sectionKey: TourSectionKey;
  /** Under ~140 chars — a single spotlight tooltip, not a paragraph. */
  message: string;
  /** The one real element this coachmark points at. */
  targetRef: RefObject<HTMLElement | null>;
  dismissLabel: string;
  placement?: "top" | "bottom";
}

/**
 * A single spotlight/tooltip that fires once per sub-feature on real first
 * arrival — dims the page, rings the one real element it's pointing at, and
 * self-dismisses forever once acknowledged (persisted via tour_state.sections_seen).
 * Never renders anything until the tour state has loaded, so it can't flash
 * on a page whose section was already seen. These are deliberately scoped to
 * SUB-features within a tab now — tab-level "what is this" orientation is
 * the guided tab tour's job (GuidedTourCoachmark).
 */
export function FirstVisitCoachmark({
  sectionKey,
  message,
  targetRef,
  dismissLabel,
  placement = "bottom",
}: FirstVisitCoachmarkProps) {
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();
  const [dismissedLocally, setDismissedLocally] = useState(false);

  if (import.meta.env.DEV && message.length > MAX_MESSAGE_CHARS) {
    console.warn(`FirstVisitCoachmark[${sectionKey}]: message is ${message.length} chars, keep it under ${MAX_MESSAGE_CHARS}`);
  }

  const alreadySeen = tourQuery.data?.tour_state.sections_seen[sectionKey] === true;
  const shouldShow = !!tourQuery.data && !alreadySeen && !dismissedLocally;

  const rect = useSpotlightRect(() => targetRef.current, shouldShow);

  function dismiss() {
    setDismissedLocally(true);
    updateTour.mutate({ sections_seen: { [sectionKey]: true } });
  }

  if (!shouldShow || !rect) return null;

  return (
    <SpotlightFrame rect={rect} placement={placement} ariaLabel={message}>
      <p className="text-sm leading-relaxed">{message}</p>
      <div className="mt-2 flex justify-end">
        <Button type="button" size="sm" onClick={dismiss}>
          {dismissLabel}
        </Button>
      </div>
    </SpotlightFrame>
  );
}
