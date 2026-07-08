/**
 * Password acceptance rule (shared by sign-up, reset, change-password, and the
 * set-password CLI so they all agree).
 *
 * Per product decision, passwords are NOT length- or complexity-gated: any
 * non-empty password is accepted — simple or strong is the user's choice. The
 * only remaining floor is Supabase Auth's own server-side "Minimum password
 * length" setting (dashboard → Authentication → Policies), which the API/DB
 * enforces regardless of what the client sends.
 */
export const MIN_PASSWORD_LENGTH = 1;

// The `too_common` variant is retained for call-site compatibility; it is no
// longer produced (the common-password denylist was removed with the strength
// requirement).
export type PasswordCheckResult = { ok: true } | { ok: false; reason: "too_short" | "too_common" };

/** Accepts any non-empty password. */
export function checkPasswordStrength(password: string): PasswordCheckResult {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "too_short" };
  return { ok: true };
}
