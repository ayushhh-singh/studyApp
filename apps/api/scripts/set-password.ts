/**
 * Set (or reset) an account's email+password via the service-role admin API.
 * Lets an account that was created via OTP/Google — and therefore has no
 * password — sign in with email + password, which sends no email and so is
 * never blocked by Supabase's OTP email rate limit.
 *
 *   pnpm --filter api set-password --email you@example.com --password 'SomeStrongPass'
 *
 * Also stamps email_confirm so a never-confirmed account can log in immediately.
 */
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from "@prayasup/shared";
import { supabase } from "../src/lib/supabase.js";

interface Args {
  email?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--password") args.password = argv[++i];
  }
  return args;
}

async function main() {
  const { email, password } = parseArgs(process.argv.slice(2));
  if (!email || !password) throw new Error("Usage: set-password --email <email> --password <password>");
  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    throw new Error(
      strength.reason === "too_short"
        ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
        : "That password is too common — choose a less guessable one",
    );
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
