import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export const SPOTLIGHT_PADDING = 6;
export const SPOTLIGHT_TOOLTIP_MAX_WIDTH = 288;
export const SPOTLIGHT_VIEWPORT_MARGIN = 12;

/**
 * Re-measures a target element's rect on mount, resize, and scroll — shared by
 * every spotlight-style overlay (FirstVisitCoachmark, GuidedTourCoachmark) so
 * the "dim the page, ring one real element" positioning math lives in one place.
 * `active` gates the effect so a hidden coachmark doesn't keep listeners live.
 */
export function useSpotlightRect(getTarget: () => HTMLElement | null, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    function measure() {
      setRect(getTarget()?.getBoundingClientRect() ?? null);
    }
    measure();
    // Coarse re-measure on resize/scroll — a first-visit hint doesn't need to
    // track a smooth-scrolling target frame-by-frame. A short-lived
    // MutationObserver also catches a target that mounts a beat after this
    // effect runs (e.g. a route whose anchor renders behind a data fetch).
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return rect;
}

interface SpotlightFrameProps {
  rect: DOMRect;
  placement?: "top" | "bottom";
  ariaLabel: string;
  children: ReactNode;
}

/**
 * The visual shell every spotlight coachmark shares: a dimmed backdrop with a
 * ring cut out around `rect`, and a positioned tooltip card. Callers supply
 * their own footer content (a single "Got it" vs a step counter + Next/Skip).
 */
export function SpotlightFrame({ rect, placement = "bottom", ariaLabel, children }: SpotlightFrameProps) {
  const reduceMotion = useReducedMotion();

  const tooltipLeft = Math.min(
    Math.max(rect.left, SPOTLIGHT_VIEWPORT_MARGIN),
    window.innerWidth - SPOTLIGHT_TOOLTIP_MAX_WIDTH - SPOTLIGHT_VIEWPORT_MARGIN,
  );
  const spaceBelow = window.innerHeight - rect.bottom;
  const showBelow = placement === "bottom" && spaceBelow > 140;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60]"
        role="dialog"
        aria-label={ariaLabel}
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
            width: SPOTLIGHT_TOOLTIP_MAX_WIDTH,
            left: tooltipLeft,
            top: showBelow ? rect.bottom + SPOTLIGHT_VIEWPORT_MARGIN : undefined,
            bottom: showBelow ? undefined : window.innerHeight - rect.top + SPOTLIGHT_VIEWPORT_MARGIN,
          }}
        >
          {children}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
