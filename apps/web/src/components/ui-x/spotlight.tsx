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
    // If the target is currently off-screen (e.g. below the fold on a long
    // page), scroll it into view BEFORE measuring — otherwise its rect can
    // land entirely outside the viewport, and SpotlightFrame's positioning
    // math pushes the tooltip (message + dismiss button) off-screen too,
    // leaving only the full-page dim with no visible way to escape it
    // (confirmed live: the evaluation page's "Share for peer review"
    // coachmark, whose target sits near the bottom of a long scrollable
    // page, did exactly this on first arrival).
    const target = getTarget();
    const initialRect = target?.getBoundingClientRect();
    const offScreen = initialRect && (initialRect.top < 0 || initialRect.bottom > window.innerHeight);
    if (target && offScreen) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    measure();
    // Coarse re-measure on resize/scroll — a first-visit hint doesn't need to
    // track a smooth-scrolling target frame-by-frame. A short-lived
    // MutationObserver also catches a target that mounts a beat after this
    // effect runs (e.g. a route whose anchor renders behind a data fetch).
    // rAF-coalesced rather than firing `measure` synchronously per event: a
    // page with continuously-mutating content (e.g. a streaming SSE answer
    // re-rendering its markdown on every delta) can otherwise fire dozens of
    // synchronous re-measures per second, repositioning the tooltip out from
    // under the user's cursor between when they aim and when they click —
    // confirmed as the likely cause of an "I can't click the dismiss button"
    // report on the mentor teach-mode coachmark, which sits right next to a
    // live-streaming answer.
    let rafId: number | null = null;
    function scheduleMeasure() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    }
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
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
  // Safety clamp: if `rect` ever describes a target that's (still, or
  // again) off-screen — e.g. useSpotlightRect's scrollIntoView hasn't
  // finished animating yet when this re-renders — never let the tooltip's
  // own offset go negative, which would push it past the opposite edge of
  // the viewport and out of view entirely (see useSpotlightRect's comment;
  // this is the belt to that suspenders).
  const tooltipTop = showBelow ? Math.max(rect.bottom + SPOTLIGHT_VIEWPORT_MARGIN, SPOTLIGHT_VIEWPORT_MARGIN) : undefined;
  const tooltipBottom = showBelow
    ? undefined
    : Math.max(window.innerHeight - rect.top + SPOTLIGHT_VIEWPORT_MARGIN, SPOTLIGHT_VIEWPORT_MARGIN);

  return createPortal(
    <AnimatePresence>
      {/*
        pointer-events-none on the full-viewport wrapper is load-bearing: a
        previous version left this (and the ring below) capturing clicks
        across the ENTIRE page, not just the visibly-dimmed area — confirmed
        live (Playwright) as the actual cause of an "I can't click a totally
        unrelated button elsewhere on the page while a coachmark is up"
        report, not just "can't click the coachmark's own dismiss button".
        Only the tooltip card re-enables pointer-events, and the ring stays
        inert so a user can still click straight through to the real
        highlighted element without the coachmark trapping them.
      */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-[60]"
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
          className="pointer-events-auto absolute rounded-xl border border-border bg-card p-3 shadow-lg"
          style={{
            width: SPOTLIGHT_TOOLTIP_MAX_WIDTH,
            left: tooltipLeft,
            top: tooltipTop,
            bottom: tooltipBottom,
          }}
        >
          {children}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
