import { useCallback, useEffect, useRef, useState } from "react";

const DISMISSED_KEY = "neev-pwa-install-dismissed";

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

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable (private mode / disabled) — never persists,
    // but the in-memory default (not dismissed) is still a safe fallback.
    return false;
  }
}

/**
 * Captures the browser's `beforeinstallprompt` event (which Chromium fires
 * once, early, then never again for that page load) so the app can trigger
 * it later from its own UI instead of relying on the native omnibox/menu
 * affordance most users never notice. `event.preventDefault()` suppresses
 * the browser's automatic mini-infobar so Neev's own banner is the only
 * prompt the user sees.
 *
 * Dismissal is a simple one-way flag in localStorage — matches
 * `pwa-update-toast.tsx`'s convention of not over-engineering re-show
 * logic for a low-stakes, easily-reachable-via-browser-menu affordance.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  // Tracks the `appinstalled` event specifically — distinct from checking
  // `display-mode: standalone` (the more common "already installed" check),
  // because the CURRENT tab doesn't switch into standalone display just by
  // installing; that only happens on a fresh launch from the installed
  // icon. Without this, a persistent "Install" entry point (unlike the
  // one-shot banner, which simply disappears once `canInstall` goes false)
  // would fall through to "here's how to install manually" immediately
  // after the user successfully installed via that exact entry point.
  const [installed, setInstalled] = useState(false);
  // Reentrancy guard for promptInstall — a ref, not state, because the
  // callback below is memoized on [deferredEvent, dismiss] and would
  // otherwise close over a stale value of an `isPrompting` state flag
  // across renders where those deps haven't changed.
  const promptingRef = useRef(false);
  const [isPrompting, setIsPrompting] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      // Already installed (via this prompt or the browser's own menu) —
      // nothing left to offer, regardless of prior dismissal state.
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

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Best-effort persistence — the in-memory state still hides the
      // banner for the rest of this session either way.
    }
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
      const choice = await deferredEvent.userChoice;
      // Chrome only allows calling prompt() once per captured event, so it's
      // spent either way — clear it, and if the user explicitly declined the
      // native dialog, treat that the same as dismissing our own banner.
      setDeferredEvent(null);
      if (choice.outcome === "dismissed") {
        dismiss();
      }
    } finally {
      promptingRef.current = false;
      setIsPrompting(false);
    }
  }, [deferredEvent, dismiss]);

  return {
    canInstall: deferredEvent !== null,
    promptInstall,
    isPrompting,
    dismissed,
    dismiss,
    installed,
  };
}
