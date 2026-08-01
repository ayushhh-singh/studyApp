/**
 * Set (or reset) an account's email+password via the service-role admin API.
 * Lets an account that was created via OTP/Google — and therefore has no
 * password — sign in with email + password, which sends no email and so is
 * never blocked by Supabase's OTP email rate limit.
 *
 *   pnpm --filter api set-password --email you@example.com --password 'SomeStrongPass'
 *
 * ⚑ If the password STARTS WITH TWO DASHES, use the `=` form:
 *   --password='--myPassword'
 * A `--`-leading token is how the arg parser detects a flag that was given no
 * value at all, so `--password --myPassword` is REFUSED rather than silently
 * misread as an empty password. `--password=<value>` is unambiguous and accepts
 * any value. (A SINGLE leading dash — `--password -myPass` — parses fine, but
 * the `=` form is the safe habit for any password with leading punctuation.)
 *
 * Also stamps email_confirm so a never-confirmed account can log in immediately.
 */
import { checkPasswordStrength } from "@neev/shared";
import { parseArgs } from "../src/ingest/_shared.js";
import { supabase } from "../src/lib/supabase.js";

interface Args {
  email?: string;
  password?: string;
}

/**
 * Every flag this CLI reads, surveyed from the actual reads in `main()`.
 *
 * ⚑ Both are plain `value` flags. A password may legitimately begin with `--`,
 * which the shared parser reads as "the previous flag was given no value" and
 * refuses (it tests `next.startsWith("--")`, so a single-dash value is fine).
 * That refusal is correct and must NOT be weakened — the operator's escape
 * hatch is the parser's own `--password=<value>` form, which cannot be misread
 * whatever the value looks like (documented in the header above).
 */
const SET_PASSWORD_FLAGS = {
  value: ["email", "password"],
} as const;

function parseCliArgs(argv: string[]): Args {
  const args = parseArgs(argv, SET_PASSWORD_FLAGS, "set-password");
  return {
    email: typeof args.email === "string" ? args.email : undefined,
    password: typeof args.password === "string" ? args.password : undefined,
  };
}

async function main() {
  const { email, password } = parseCliArgs(process.argv.slice(2));
  if (!email || !password) {
    throw new Error(
      "Usage: set-password --email <email> --password <password>\n" +
        "       (if the password starts with '--', use the --password=<value> form)",
    );
  }
  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    throw new Error("Password cannot be empty");
  }

  const db = supabase();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No auth user found with email ${email} — sign in once (OTP/Google) to create it first`);

  const upd = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (upd.error) throw new Error(`updateUser failed: ${upd.error.message}`);
  console.log(`\n✓ Password set for ${email} (id ${user.id}). You can now sign in with email + password.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nset-password failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
