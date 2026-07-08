import { supabaseBrowser } from "./supabase";

/**
 * Non-React auth helpers shared by api.ts and sse.ts, which can't read the
 * AuthProvider context. getAccessToken() reads the current session via
 * supabase-js, which returns a still-valid token or transparently refreshes an
 * expired one — so callers are refresh-aware without any manual bookkeeping.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * A single handler invoked when the API rejects a request as unauthenticated
 * (401) despite us having attached a token — i.e. the session is truly dead
 * (refresh token revoked/expired). The AuthProvider registers one that signs
 * out and bounces to the auth page; kept as a module hook so the plain fetch
 * layer can trigger it without importing React.
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export function handleUnauthorized(): void {
  onUnauthorized?.();
}
