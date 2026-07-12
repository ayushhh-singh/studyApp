import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { TourSectionKey } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";

const MAX_MESSAGE_CHARS = 140;
const SPOTLIGHT_PADDING = 6;
const TOOLTIP_MAX_WIDTH = 288;
const VIEWPORT_MARGIN = 12;

interface FirstVisitCoachmarkProps {
  /** Which of the 8 tour sections this fires for — persisted so it never fires twice. */
  sectionKey: TourSectionKey;
  /** Under ~140 chars — a single spotlight tooltip, not a paragraph. */
  message: string;
  /** The one real element this coachmark points at. */
  targetRef: RefObject<HTMLElement | null>;
  dismissLabel: string;
  placement?: "top" | "bottom";
}

/**
 * A single spotlight/tooltip that fires once per section on real first
 * arrival — dims the page, rings the one real element it's pointing at, and
 * self-dismisses forever once acknowledged (persisted via tour_state.sections_seen).
 * Never renders anything until the tour state has loaded, so it can't flash
 * on a page whose section was already seen.
 */
export function FirstVisitCoachmark({
  sectionKey,
  message,
  targetRef,
  dismissLabel,
  placement = "bottom",
}: FirstVisitCoachmarkProps) {
  const reduceMotion = useReducedMotion();
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dismissedLocally, setDismissedLocally] = useState(false);

  if (import.meta.env.DEV && message.length > MAX_MESSAGE_CHARS) {
    console.warn(`FirstVisitCoachmark[${sectionKey}]: message is ${message.length} chars, keep it under ${MAX_MESSAGE_CHARS}`);
  }

  const alreadySeen = tourQuery.data?.tour_state.sections_seen[sectionKey] === true;
  const shouldShow = !!tourQuery.data && !alreadySeen && !dismissedLocally;

  useEffect(() => {
    if (!shouldShow) return;
    function measure() {
      setRect(targetRef.current?.getBoundingClientRect() ?? null);
    }
    measure();
    // Coarse re-measure on resize/scroll — a first-visit hint doesn't need to
    // track a smooth-scrolling target frame-by-frame.
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow]);

  function dismiss() {
    setDismissedLocally(true);
    updateTour.mutate({ sections_seen: { [sectionKey]: true } });
  }

  if (!shouldShow || !rect) return null;

  const tooltipLeft = Math.min(
    Math.max(rect.left, VIEWPORT_MARGIN),
    window.innerWidth - TOOLTIP_MAX_WIDTH - VIEWPORT_MARGIN,
  );
  const spaceBelow = window.innerHeight - rect.bottom;
  const showBelow = placement === "bottom" && spaceBelow > 140;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60]"
        role="dialog"
        aria-label={message}
        initial={reduceMotion ? undefined : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
      >
        {/* Spotlight: a transparent ring around the target with a giant box-shadow
            dimming everything else — a cutout without a clip-path mask. */}
        <div
          className="absolute rounded-lg ring-2 ring-primary"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(18,20,28,0.6)",
          }}
        />
        <div
          className="absolute rounded-xl border border-border bg-card p-3 shadow-lg"
          style={{
            width: TOOLTIP_MAX_WIDTH,
            left: tooltipLeft,
            top: showBelow ? rect.bottom + VIEWPORT_MARGIN : undefined,
            bottom: showBelow ? undefined : window.innerHeight - rect.top + VIEWPORT_MARGIN,
          }}
        >
          <p className="text-sm leading-relaxed">{message}</p>
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" onClick={dismiss}>
              {dismissLabel}
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
