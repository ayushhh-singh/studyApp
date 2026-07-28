/**
 * Recover from stale-deploy chunk-load failures.
 *
 * A Vite SPA splits routes into hash-named chunks. When a new deploy changes
 * those hashes, a tab still holding the OLD index.html 404s on the old chunk the
 * moment the user navigates to a lazy route — surfacing as "Failed to fetch
 * dynamically imported module", which otherwise falls straight through to the
 * app error boundary ("Something went wrong").
 *
 * Vite dispatches a `vite:preloadError` event on `window` in exactly this case.
 * The fix is to reload once so the browser fetches a fresh index.html carrying
 * the current chunk hashes. We rate-limit to at most one reload per 10s (per-tab
 * sessionStorage), so a genuinely broken deploy — where the fresh HTML ALSO
 * fails — can't reload-loop: the second failure inside the window is left to
 * propagate to the error boundary instead of triggering another reload.
 *
 * We deliberately do NOT call event.preventDefault(): on the reload branch the
 * navigation supersedes any thrown error anyway, and on the no-reload branch we
 * WANT the error to reach the boundary.
 */
const LAST_RELOAD_KEY = "neev.lastChunkReload";
const MIN_RELOAD_INTERVAL_MS = 10_000;

export function installChunkReloadHandler(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", () => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) ?? 0);
    } catch {
      /* storage disabled — fall through to a single reload attempt */
    }
    const now = Date.now();
    if (now - last < MIN_RELOAD_INTERVAL_MS) return; // already tried recently → let it error out
    try {
      sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
    } catch {
      /* ignore — the reload still fixes the common case */
    }
    window.location.reload();
  });
}
