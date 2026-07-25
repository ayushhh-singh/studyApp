/**
 * Manage sukoon_beta_cohort membership (Session 14: SUKOON_BETA_COHORT
 * gating — see apps/api/src/sukoon/services/beta.ts). Only meaningful while
 * SUKOON_BETA_COHORT isn't set to "false" (config.ts's betaCohortGating) —
 * once ops opens the beta to everyone, cohort membership no longer matters.
 *
 *   pnpm --filter api sukoon:beta:cohort --list
 *   pnpm --filter api sukoon:beta:cohort --add --email a@x.com [--note "..."]
 *   pnpm --filter api sukoon:beta:cohort --add --emails-file cohort.txt   (one email per line, launch-scale)
 *   pnpm --filter api sukoon:beta:cohort --remove --email a@x.com
 *
 * Resolves each email to a real auth.users id via the admin API (paginated —
 * listUsers() defaults to a small page size, which would silently miss users
 * past page 1 on a Neev-sized user base).
 */
import { readFileSync } from "node:fs";
import { supabase } from "../src/lib/supabase.js";

interface Args {
  mode: "list" | "add" | "remove" | null;
  email?: string;
  emailsFile?: string;
  note?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list") args.mode = "list";
    else if (argv[i] === "--add") args.mode = "add";
    else if (argv[i] === "--remove") args.mode = "remove";
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--emails-file") args.emailsFile = argv[++i];
    else if (argv[i] === "--note") args.note = argv[++i];
  }
  return args;
}

/** All auth users, paginated — listUsers()'s default page size is too small
 *  to trust for a real (non-toy) user base. */
async function listAllAuthUsers(): Promise<{ id: string; email: string | null }[]> {
  const db = supabase();
  const users: { id: string; email: string | null }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < 1000) break;
  }
  return users;
}

function readEmails(args: Args): string[] {
  if (args.emailsFile) {
    return readFileSync(args.emailsFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (args.email) return [args.email];
  throw new Error("Provide --email <email> or --emails-file <path>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    throw new Error("Usage: sukoon-beta-cohort --list | --add | --remove [--email ... | --emails-file ...] [--note ...]");
  }

  const db = supabase();

  if (args.mode === "list") {
    const { data, error } = await db
      .from("sukoon_beta_cohort")
      .select("user_id, note, added_at")
      .order("added_at", { ascending: true });
    if (error) throw new Error(`list failed: ${error.message}`);
    console.log(`\nSukoon beta cohort: ${data?.length ?? 0} member(s)\n`);
    for (const row of data ?? []) {
      console.log(`  ${row.user_id}${row.note ? `  (${row.note})` : ""}  — added ${row.added_at}`);
    }
    return;
  }

  const emails = readEmails(args);
  const authUsers = await listAllAuthUsers();
  const byEmail = new Map(authUsers.map((u) => [u.email?.toLowerCase(), u.id]));

  const resolved: { email: string; id: string }[] = [];
  const missing: string[] = [];
  for (const email of emails) {
    const id = byEmail.get(email.toLowerCase());
    if (id) resolved.push({ email, id });
    else missing.push(email);
  }

  if (missing.length > 0) {
    console.warn(`\n⚠ ${missing.length} email(s) have no matching Neev account (skipped):`);
    for (const e of missing) console.warn(`  ${e}`);
  }

  if (args.mode === "add") {
    for (const { email, id } of resolved) {
      const { error } = await db
        .from("sukoon_beta_cohort")
        .upsert({ user_id: id, note: args.note ?? null }, { onConflict: "user_id" });
      if (error) {
        console.error(`  ✗ ${email}: ${error.message}`);
      } else {
        console.log(`  ✓ ${email} added to the beta cohort`);
      }
    }
  } else {
    for (const { email, id } of resolved) {
      const { error } = await db.from("sukoon_beta_cohort").delete().eq("user_id", id);
      if (error) {
        console.error(`  ✗ ${email}: ${error.message}`);
      } else {
        console.log(`  ✓ ${email} removed from the beta cohort`);
      }
    }
  }
  console.log(`\nDone — ${resolved.length}/${emails.length} email(s) processed.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nsukoon-beta-cohort failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
