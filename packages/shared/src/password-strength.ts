/**
 * Shared minimum-strength check for any flow that sets a password — sign-up
 * uses its own lighter (length-only) check, but reset/change/the CLI must all
 * agree on one rule so a user can't be told "too weak" in one place and
 * accepted in another.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * The ~100 most commonly breached passwords (lowercased), drawn from public
 * breach-frequency lists (e.g. "RockYou"/Have I Been Pwned-style top lists).
 * A denylist, not a strength score — good enough to block the obvious ones
 * without pretending to be a real strength estimator (zxcvbn territory).
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "123456", "123456789", "12345678", "12345", "1234567", "qwerty", "password",
  "111111", "123123", "abc123", "1234567890", "1q2w3e4r", "000000", "iloveyou",
  "1234", "1q2w3e", "qwertyuiop", "123", "monkey", "dragon", "123321",
  "654321", "666666", "letmein", "password1", "123456a", "121212", "welcome",
  "1qaz2wsx", "master", "michael", "superman", "696969", "sunshine",
  "princess", "football", "baseball", "shadow", "trustno1", "hunter",
  "freedom", "whatever", "qazwsx", "michelle", "jessica", "charlie",
  "jennifer", "starwars", "computer", "michelle1", "corvette", "hello123",
  "hello", "admin", "admin123", "root", "toor", "pass", "pass123",
  "passw0rd", "p@ssw0rd", "test", "test123", "guest", "guest123",
  "changeme", "temp123", "temppass", "asdfghjkl", "asdf1234", "zxcvbnm",
  "zxcvbn", "qweasdzxc", "qwe123", "abcd1234", "a1b2c3d4", "iloveyou1",
  "iloveyou2", "loveyou", "letmein1", "welcome1", "welcome123", "monkey1",
  "dragon1", "football1", "baseball1", "sunshine1", "princess1", "flower",
  "summer", "winter", "autumn", "december", "september", "chocolate",
  "cheese", "purple", "orange", "yellow", "1111111", "2222222", "7777777",
  "8888888", "9999999", "01234567", "10203040", "192837465", "123456789a",
  "aaaaaaaa", "abcdefgh", "abcdefghi", "abcabc123", "letme1n", "123qwe",
  "qazxsw", "zaq1zaq1", "myspace1", "blink182", "pokemon", "batman",
  "spiderman", "ilovegod", "ilovemom", "ilovedad", "iloveyou123", "123456q",
  "password123", "password1234", "wordpass", "1234qwer",
]);

export type PasswordCheckResult = { ok: true } | { ok: false; reason: "too_short" | "too_common" };

/** Enforces length + a common-password denylist. Never rejects on anything else. */
export function checkPasswordStrength(password: string): PasswordCheckResult {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "too_short" };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return { ok: false, reason: "too_common" };
  return { ok: true };
}
