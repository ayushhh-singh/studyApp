/**
 * Sukoon is self-contained per CLAUDE.md's module rules: this file is the
 * ONE place its env flags are read, so the rest of apps/api/src/sukoon never
 * touches process.env directly.
 */

export type SukoonMode = "integrated" | "standalone";

function readMode(): SukoonMode {
  return process.env.SUKOON_MODE === "standalone" ? "standalone" : "integrated";
}

// Enabled unless explicitly turned off — keeps the scaffold visible on this
// branch without extra env setup, while still giving ops a kill switch
// (matches the blueprint's Session-14 launch plan: merge behind this flag,
// then flip it on for a beta cohort).
function readEnabled(): boolean {
  return process.env.SUKOON_ENABLED !== "false";
}

/**
 * Dev-only tooling (the /dev/crisis assessment probe, blueprint F3). ON when
 * SUKOON_DEV_TOOLS=true OR whenever we're not in production — so it's available
 * for local/staging testing but a plain production boot never exposes it unless
 * explicitly asked. The matching frontend route is gated by import.meta.env.DEV.
 */
function readDevTools(): boolean {
  if (process.env.SUKOON_DEV_TOOLS === "true") return true;
  if (process.env.SUKOON_DEV_TOOLS === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * F4 journal encryption key (pgcrypto pgp_sym_encrypt). Read lazily, not at
 * boot — an unset key must not crash the whole API (other Sukoon features still
 * work); the journal service throws a clear 500 the first time a journal op is
 * attempted without it.
 */
export function journalEncKey(): string | undefined {
  const k = process.env.JOURNAL_ENC_KEY;
  return k && k.length > 0 ? k : undefined;
}

export const sukoonConfig = {
  mode: readMode(),
  enabled: readEnabled(),
  devTools: readDevTools(),
};
