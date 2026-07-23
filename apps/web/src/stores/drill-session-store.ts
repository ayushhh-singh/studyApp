import { create } from "zustand";
import type { DrillSession } from "@neev/shared";

/**
 * Ephemeral in-memory handoff for the active micro-drill session, from the
 * "Start drill" CTA on /profile to the dedicated /profile/drill route. There
 * is no `GET /drills/:id` endpoint in the contract (only create / patch
 * responses / evaluate / history), so the session can't be rehydrated from
 * the server on a hard refresh — a refresh mid-drill loses progress and the
 * route falls back to its "no active session" empty state, same as any other
 * purely-client-side wizard step would.
 */
interface DrillSessionState {
  session: DrillSession | null;
  /** Full locale-prefixed path the drill was started from (e.g. `/en/answers`
   * vs `/en/profile`) — MicroDrillsCard now renders on more than one page, so
   * "Exit"/"Try another" must return wherever the user actually came from,
   * not always Profile. `null` until a drill is actually started in this
   * browser session (e.g. `/profile/drill` opened directly/refreshed with no
   * session in memory) — the router has no bare `/profile` route (only
   * `/:locale/*`), so a caller MUST fall back to a locale-prefixed path
   * itself rather than this store guessing one without a locale. */
  returnTo: string | null;
  setSession: (session: DrillSession | null, returnTo?: string) => void;
}

export const useDrillSessionStore = create<DrillSessionState>((set) => ({
  session: null,
  returnTo: null,
  setSession: (session, returnTo) => set((state) => ({ session, returnTo: returnTo ?? state.returnTo })),
}));
