import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `beforeinstallprompt` isn't in standard lib.dom.d.ts — Chromium-only,
 * never fires in Safari/Firefox, and never fires in dev unless the app
 * genuinely meets installability criteria (served over HTTPS or localhost,
 * registered SW, valid manifest).
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/**
 * Captures the browser's `beforeinstallprompt` event (which Chromium fires
 * once, early, then never again for that page load) so the app can trigger
 * it later from its own UI instead of relying on the native omnibox/menu
 * affordance most users never notice. `event.preventDefault()` suppresses
 * the browser's automatic mini-infobar so Neev's own UI is the only prompt
 * the user sees.
 *
 * Two consumers: `PwaInstallButton` (a quiet icon in the sticky TopBar,
 * the common quick-access path) and `InstallAppCard` (Profile > Settings,
 * the full picture — manual instructions for non-Chromium browsers, an
 * "already installed" state) — the same TopBar-icon/Settings-card split
 * this app already uses for notifications (`NotificationBell` +
 * `PushNotificationsCard`). Neither needs a "dismiss forever" concept: a
 * small icon that only appears when genuinely actionable isn't naggy
 * enough to warrant one.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  // Tracks the `appinstalled` event specifically — distinct from checking
  // `display-mode: standalone` (the more common "already installed" check),
  // because the CURRENT tab doesn't switch into standalone display just by
  // installing; that only happens on a fresh launch from the installed
  // icon. Without this, a persistent "Install" entry point would fall
  // through to "here's how to install manually" immediately after the
  // user successfully installed via that exact entry point.
  const [installed, setInstalled] = useState(false);
  // Reentrancy guard for promptInstall — a ref, not state, because the
  // callback below is memoized on [deferredEvent] and would otherwise
  // close over a stale value of an `isPrompting` state flag across
  // renders where that dep hasn't changed.
  const promptingRef = useRef(false);
  const [isPrompting, setIsPrompting] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      // Already installed (via this prompt or the browser's own menu) —
      // nothing left to offer.
      setDeferredEvent(null);
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    // Guards against a double-click (or any re-entrant call) firing
    // `.prompt()` again on an event that's already mid-flight — Chromium
    // only allows one live prompt() per captured event, and nothing else
    // here prevented a second call before the first's userChoice resolves.
    if (!deferredEvent || promptingRef.current) return;
    promptingRef.current = true;
    setIsPrompting(true);
    try {
      await deferredEvent.prompt();
      await deferredEvent.userChoice;
      // Chrome only allows calling prompt() once per captured event, so
      // it's spent either way (accepted or declined) — clear it. A fresh
      // page load gets a fresh event, so declining isn't sticky here the
      // way it would need to be for a persistent banner.
      setDeferredEvent(null);
    } finally {
      promptingRef.current = false;
      setIsPrompting(false);
    }
  }, [deferredEvent]);

  return {
    canInstall: deferredEvent !== null,
    promptInstall,
    isPrompting,
    installed,
  };
}
