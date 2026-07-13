import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      // Already installed (via this prompt or the browser's own menu) —
      // nothing left to offer, regardless of prior dismissal state.
      setDeferredEvent(null);
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
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    // Chrome only allows calling prompt() once per captured event, so it's
    // spent either way — clear it, and if the user explicitly declined the
    // native dialog, treat that the same as dismissing our own banner.
    setDeferredEvent(null);
    if (choice.outcome === "dismissed") {
      dismiss();
    }
  }, [deferredEvent, dismiss]);

  return {
    canInstall: deferredEvent !== null,
    promptInstall,
    dismissed,
    dismiss,
  };
}
