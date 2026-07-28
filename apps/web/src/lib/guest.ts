/**
 * Guest/anonymous-session helpers shared across the auth provider, the landing
 * auto-guest starter, and the trial-claim-on-conversion hook.
 */

/**
 * localStorage flag set the moment a guest STARTS converting (email/password or
 * Google) and read after the session becomes non-anonymous to fire exactly one
 * POST /auth/claim-trial. Survives the OAuth redirect (localStorage, not memory),
 * so both the inline email path and the redirect Google path are covered, and a
 * fresh (never-guest) signup — which never sets it — makes no redundant call.
 */
export const PENDING_TRIAL_CLAIM_KEY = "neev.pendingTrialClaim";

export function markTrialClaimPending(): void {
  try {
    localStorage.setItem(PENDING_TRIAL_CLAIM_KEY, "1");
  } catch {
    /* private mode / storage disabled — the claim just won't auto-fire */
  }
}

export function hasTrialClaimPending(): boolean {
  try {
    return localStorage.getItem(PENDING_TRIAL_CLAIM_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearTrialClaimPending(): void {
  try {
    localStorage.removeItem(PENDING_TRIAL_CLAIM_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * sessionStorage flag so the landing auto-guest starter attempts a guest sign-in
 * at most once per tab — a failure (anonymous sign-ins disabled, rate-limited)
 * must not retry on every re-render/navigation back to the landing page.
 */
const GUEST_AUTOSTART_TRIED_KEY = "neev.guestAutostartTried";

export function guestAutostartAlreadyTried(): boolean {
  try {
    return sessionStorage.getItem(GUEST_AUTOSTART_TRIED_KEY) === "1";
  } catch {
    return true; // no storage → don't attempt (safer)
  }
}

export function markGuestAutostartTried(): void {
  try {
    sessionStorage.setItem(GUEST_AUTOSTART_TRIED_KEY, "1");
  } catch {
    /* ignore */
  }
}
