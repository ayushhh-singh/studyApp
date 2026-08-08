/**
 * Small, dependency-free PWA platform checks. Kept separate from
 * `use-install-prompt.ts` (which owns the Chromium `beforeinstallprompt`
 * capture) since these read static browser state rather than an event.
 */

/** True once the app is already running as an installed/standalone app —
 * on any platform, `beforeinstallprompt` never fires again after install,
 * so this is the only reliable "already installed" signal. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  // iOS Safari has no `display-mode` media query support for standalone
  // detection pre-install, but exposes the non-standard `navigator.standalone`.
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** iOS Safari never fires `beforeinstallprompt` — "Add to Home Screen" is
 * reachable only via the Share sheet, so it needs its own instructions. */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports its UA as "Macintosh" (desktop-class request), but
  // unlike a real Mac it's touch-capable — maxTouchPoints distinguishes them.
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}
