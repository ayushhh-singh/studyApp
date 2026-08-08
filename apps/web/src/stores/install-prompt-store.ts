import { create } from "zustand";

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

interface InstallPromptState {
  deferredEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  isPrompting: boolean;
}

/**
 * A Zustand store rather than per-hook-instance React state, because the
 * underlying `beforeinstallprompt` event is a genuine page-level SINGLETON
 * (the browser fires it once, and only one copy of it exists), while
 * `useInstallPrompt()` is called from two places that can be mounted at
 * the same time — `PwaInstallButton` (always, via the sticky TopBar) and
 * `InstallAppCard` (on the Profile page, nested under that same TopBar).
 *
 * An earlier version of this kept `deferredEvent`/`isPrompting` as local
 * `useState` inside the hook itself. Both call sites captured a reference
 * to the SAME underlying event object (event listeners fire for every
 * subscriber), but each had its OWN independent "is a prompt() call
 * currently in flight" guard — so visiting Profile (where both render at
 * once) and clicking both buttons in quick succession called `.prompt()`
 * TWICE on one already-spent event. Real Chromium rejects the second call
 * with `InvalidStateError`, which — since both callers fire-and-forget via
 * `void promptInstall()` — surfaced as an unhandled promise rejection
 * printed to the console. Confirmed live before this fix, confirmed gone
 * after. Sharing the store (and its reentrancy guard) across every
 * consumer is what actually closes it, not tightening the guard further.
 */
const useInstallPromptStore = create<InstallPromptState>(() => ({
  deferredEvent: null,
  installed: false,
  isPrompting: false,
}));

// Registered once, at module load — NOT per-hook-instance, and NOT inside a
// React effect (which would need one consumer to "own" mount/unmount timing
// for a resource that's really app-lifetime-scoped, exactly like
// theme-store.ts applying the initial theme at module load rather than
// inside a component). Safe even if this module is imported multiple times
// across separate chunks: ES modules are singletons, so this body runs once.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    useInstallPromptStore.setState({ deferredEvent: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    // Already installed (via this prompt or the browser's own menu) —
    // nothing left to offer.
    useInstallPromptStore.setState({ deferredEvent: null, installed: true });
  });
}

// A plain module-level flag, not store state — promptInstall() needs a
// synchronous read-then-write immediately on entry, before any React
// re-render (and hence before any state read a caller might otherwise rely
// on) could reflect an in-progress call.
let promptingInFlight = false;

async function promptInstall() {
  const { deferredEvent } = useInstallPromptStore.getState();
  // Guards against a double-click, or (the case this exists for) two
  // separate mounted components each independently triggering install —
  // Chromium only allows one live prompt() per captured event.
  if (!deferredEvent || promptingInFlight) return;
  promptingInFlight = true;
  useInstallPromptStore.setState({ isPrompting: true });
  try {
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // Chrome only allows calling prompt() once per captured event, so
    // it's spent either way (accepted or declined) — clear it. A fresh
    // page load gets a fresh event, so declining isn't sticky here the
    // way it would need to be for a persistent banner.
    useInstallPromptStore.setState({ deferredEvent: null });
  } finally {
    promptingInFlight = false;
    useInstallPromptStore.setState({ isPrompting: false });
  }
}

/**
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
  const deferredEvent = useInstallPromptStore((s) => s.deferredEvent);
  const installed = useInstallPromptStore((s) => s.installed);
  const isPrompting = useInstallPromptStore((s) => s.isPrompting);

  return {
    canInstall: deferredEvent !== null,
    promptInstall,
    isPrompting,
    installed,
  };
}
