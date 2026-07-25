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
 * Session 14 launch gate: while true (the default — a fresh beta launch),
 * only users in sukoon_beta_cohort (or a Neev admin) see the Wellness nav item
 * / homepage card and are treated as `in_cohort` by GET /beta/status. Ops
 * flips SUKOON_BETA_COHORT=false once the beta graduates to a full rollout —
 * at that point every user reads as in_cohort, with no code change or table
 * edit needed (mirrors SUKOON_ENABLED's "off unless explicitly disabled" shape,
 * just inverted: this one is "gated unless explicitly opened").
 */
function readBetaCohortGating(): boolean {
  return process.env.SUKOON_BETA_COHORT !== "false";
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

export type SukoonTtsProvider = "openai" | "sarvam";

/**
 * F10 Voice Mode's TTS vendor (blueprint: "TTS via provider abstraction
 * (env-selected: openai gpt-4o-mini-tts | sarvam bulbul)"). Defaults to
 * openai — it's the one this repo already has real credentials for
 * (OPENAI_API_KEY); switching to sarvam additionally needs SARVAM_API_KEY
 * (see lib/tts.ts / apps/api/.env.example).
 */
function readTtsProvider(): SukoonTtsProvider {
  return process.env.SUKOON_TTS_PROVIDER === "sarvam" ? "sarvam" : "openai";
}

export const sukoonConfig = {
  mode: readMode(),
  enabled: readEnabled(),
  devTools: readDevTools(),
  ttsProvider: readTtsProvider(),
  betaCohortGating: readBetaCohortGating(),
};
