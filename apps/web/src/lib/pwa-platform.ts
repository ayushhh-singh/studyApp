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

/** A common UA substring shared by every Chromium-family browser (Chrome,
 * Edge, Opera, Samsung Internet, Brave's underlying engine, …) — every one
 * of them ALSO carries a legacy "Safari" token for compatibility, so this
 * is what makes `isMacSafari()` below reliable rather than a false
 * positive on, say, Chrome running on a Mac. Brave itself deliberately
 * omits any Brave-specific UA token (by design, for anti-fingerprinting),
 * so it's indistinguishable from Chrome here — correctly so, since it's
 * Chromium-based and genuinely does support install the same way. */
const CHROMIUM_FAMILY_UA = /Chrome|Chromium|CriOS|Edg\/|OPR\//i;

/** Genuine desktop Firefox — excludes Firefox for Android (whose UA always
 * includes "Android"), which keeps its own separate manual "Add to Home
 * screen" menu item unlike desktop Firefox. Desktop Firefox removed native
 * "install as app" (Site Specific Browser) support in Firefox 86 (2021)
 * and has never brought it back — pointing a desktop Firefox user at "look
 * for Install app in your browser's menu" sends them looking for
 * something that genuinely doesn't exist there. iOS Firefox is already
 * routed to `isIosDevice()`'s branch before this is ever checked. */
export function isFirefoxDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return ua.includes("Firefox") && !ua.includes("Android") && !ua.includes("Mobile");
}

/** Genuine desktop Safari on macOS — `isIosDevice()`'s touch-capability
 * check already routes iPadOS (which shares Safari's "Macintosh" UA
 * prefix) to the iOS branch before this is ever reached, so anything
 * left with a "Macintosh" UA here is a real non-touch Mac. Excludes every
 * Chromium-family browser via `CHROMIUM_FAMILY_UA`, since Chrome/Edge/etc.
 * on Mac also carry a legacy "Safari" token. macOS Sonoma (2023) and later
 * can install a web app via File > Add to Dock (or Share button > Add to
 * Dock in Safari's own toolbar) — a real, different action from what the
 * generic Chromium "look for Install app" wording describes. */
export function isMacSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return ua.includes("Macintosh") && ua.includes("Safari") && !CHROMIUM_FAMILY_UA.test(ua);
}
