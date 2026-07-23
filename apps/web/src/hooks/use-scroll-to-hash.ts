import { useEffect } from "react";
import { useLocation } from "react-router";

/** How long to keep correcting the scroll position for late layout growth
 * above the target (e.g. sibling cards still loading their own async data)
 * before giving up and leaving the user wherever the last correction landed. */
const SETTLE_TIMEOUT_MS = 4000;
/** Debounce between a layout resize and re-issuing the scroll, so a burst of
 * resizes (several cards resolving in quick succession) only re-scrolls once. */
const DEBOUNCE_MS = 150;
/** Any of these means the user has taken over scrolling themselves — stop
 * correcting immediately rather than yanking them back to the target for the
 * rest of the settle window. */
const USER_INTERACTION_EVENTS = ["wheel", "touchstart", "keydown"] as const;

/**
 * Scrolls to the element whose id matches `location.hash` after a route
 * change. A client-side route transition doesn't get the browser's native
 * anchor-jump behavior a full page load would, so cross-route "deep link to
 * a section" links (e.g. Learn's "see mastery matrix" -> Profile#mastery-matrix)
 * need this to actually land on the section instead of just the top of the page.
 *
 * A single scrollIntoView on mount isn't enough: several cards above a
 * typical target (analytics charts, mastery tables) render a skeleton first
 * and grow once their own query resolves, which can push the real target
 * further down mid-scroll or right after it — live-verified to land the
 * scroll ~250px short of the target depending on how the async loads
 * interleave. A ResizeObserver on <body> re-issues the scroll whenever the
 * page's height changes, so it keeps correcting until layout settles.
 *
 * That auto-correction stops the moment the user scrolls/touches/presses a
 * key themselves — otherwise someone who deep-links in and immediately
 * scrolls away to read something else could get yanked back to the target
 * by a late-resolving card elsewhere on the page for up to SETTLE_TIMEOUT_MS.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));

    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let hasFocused = false;

    const scroll = () => {
      // Re-checked here, not just where each scroll gets *scheduled* (inside
      // the ResizeObserver callback below) — a debounce timer or the initial
      // raf can still be in flight the instant `stop` runs, and clearing it
      // there isn't airtight against every event-ordering edge case. This is
      // the actual point of action, so it's the one place a stale,
      // already-cancelled scroll can be reliably refused.
      if (stopped) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      // Move focus (not just the viewport) to the target once, so keyboard
      // and screen-reader users actually land in the section too — but only
      // on the first successful scroll, since re-focusing on every
      // correction would yank a screen-reader user's reading position
      // repeatedly, which is worse than the visual-only correction is.
      if (!hasFocused) {
        hasFocused = true;
        el.focus({ preventScroll: true });
      }
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(debounceTimer);
      observer.disconnect();
      for (const event of USER_INTERACTION_EVENTS) {
        window.removeEventListener(event, stop);
      }
    };

    const observer = new ResizeObserver(() => {
      if (stopped) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scroll, DEBOUNCE_MS);
    });
    observer.observe(document.body);

    for (const event of USER_INTERACTION_EVENTS) {
      window.addEventListener(event, stop, { passive: true, once: true });
    }

    const raf = requestAnimationFrame(scroll);
    const stopTimer = setTimeout(stop, SETTLE_TIMEOUT_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stopTimer);
      stop();
    };
  }, [hash]);
}
