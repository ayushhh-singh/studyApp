/**
 * The current Sukoon wellness-consent version — a SERVER-side constant, never
 * accepted from the client (SUKOON_CONTEXT hard rule: consent is versioned and
 * server-owned). The onboarding endpoint stamps this onto every sukoon_consents
 * row; bumping it here is what forces returning users to re-consent (a fresh row
 * is minted, since the table is unique on (user_id, consent_version)).
 *
 * Bump this string whenever the wellness-not-therapy consent COPY changes
 * materially. Keep it human-legible and monotonic.
 */
export const SUKOON_CONSENT_VERSION = "2026-07-24.v1";
