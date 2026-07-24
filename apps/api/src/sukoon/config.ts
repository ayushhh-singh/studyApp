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

export const sukoonConfig = {
  mode: readMode(),
  enabled: readEnabled(),
};
