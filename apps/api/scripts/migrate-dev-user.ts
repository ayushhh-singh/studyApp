/**
 * One-time data migration: re-point every row owned by the pre-auth dev user
 * (fixed uuid) to your real Supabase Auth user, then fold and remove the dev
 * profile row.
 *
 *   pnpm migrate:dev-user --to <auth-uuid>
 *   pnpm migrate:dev-user --email you@example.com     # look the uuid up by email
 *   pnpm migrate:dev-user --to <uuid> --from <uuid>   # override the dev uuid
 *   pnpm migrate:dev-user --to <uuid> --dry-run       # report only, write nothing
 *
 * Strategy per child table: UPDATE user_id dev -> real. If that hits a unique
 * violation (the fresh real account already has a colliding row — e.g. a
 * per-user PK), delete the real account's rows in that table and retry, so the
 * richer dev-account history wins. The profile row is merged (streak/plan
 * carried over) and the dev row deleted last, once nothing references it.
 */
import { supabase } from "../src/lib/supabase.js";

const DEV_UUID = "00000000-0000-4000-8000-000000000001";

// Tables with their OWN user_id column referencing users_profile. Child tables
// scoped through a parent (attempt_answers→attempts, evaluations→answer_submissions,
// doubt_messages→doubt_threads) are intentionally omitted — re-pointing the
// parent carries them, since they FK the parent's PK, not user_id. doubt_faq_cache
// and content embeddings are not user-scoped.
const USER_TABLES = [
  "attempts",
  "answer_submissions",
  "srs_cards",
  "srs_reviews",
  "events",
  "milestones",
  "daily_stats",
  "personal_bests",
  "node_mastery",
  "notification_schedule",
  "drill_sessions",
  "study_plans",
  "learner_profiles",
  "mentor_insights",
  "doubt_threads",
  "llm_calls",
] as const;

interface Args {
  to?: string;
  from: string;
  email?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: DEV_UUID, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") args.to = argv[++i];
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--email") args.email = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function resolveTargetId(args: Args): Promise<string> {
  if (args.to) return args.to;
  if (!args.email) throw new Error("Provide --to <auth-uuid> or --email <email>");
  // Look up the auth user by email via the admin API (service role).
  const { data, error } = await supabase().auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const match = data.users.find((u) => u.email?.toLowerCase() === args.email!.toLowerCase());
  if (!match) throw new Error(`No auth user found with email ${args.email}`);
  return match.id;
}

async function countRows(table: string, userId: string): Promise<number> {
  const { count, error } = await supabase()
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`count ${table} failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = supabase();

  const fromId = args.from;
  const toId = await resolveTargetId(args);

  if (fromId === toId) throw new Error("--from and --to are the same id");

  // Sanity: both profile rows must exist (the target is created by the
  // on_auth_user_created trigger at first sign-in).
  const { data: profiles, error: pErr } = await db
    .from("users_profile")
    .select("id, display_name, streak_count, streak_freezes, last_active_date, plan")
    .in("id", [fromId, toId]);
  if (pErr) throw new Error(`profile lookup failed: ${pErr.message}`);
  const dev = profiles?.find((p) => p.id === fromId);
  const real = profiles?.find((p) => p.id === toId);
  if (!dev) throw new Error(`Source (dev) profile ${fromId} not found — already migrated?`);
  if (!real) throw new Error(`Target profile ${toId} not found — sign in first so the trigger creates it`);

  console.log(`\nMigrating data:\n  from ${fromId} (dev)\n  to   ${toId} (${real.display_name ?? "real user"})`);
  if (args.dryRun) console.log("  [DRY RUN — no writes]\n");

  let moved = 0;
  for (const table of USER_TABLES) {
    const n = await countRows(table, fromId);
    if (n === 0) {
      console.log(`  ${table.padEnd(22)} 0`);
      continue;
    }
    if (args.dryRun) {
      console.log(`  ${table.padEnd(22)} ${n} (would move)`);
      moved += n;
      continue;
    }

    let { error } = await db.from(table).update({ user_id: toId }).eq("user_id", fromId);
    if (error && error.code === "23505") {
      // Collision with a fresh row on the real account — drop it and retry so
      // the dev-account history wins.
      const del = await db.from(table).delete().eq("user_id", toId);
      if (del.error) throw new Error(`clear ${table} (real) failed: ${del.error.message}`);
      ({ error } = await db.from(table).update({ user_id: toId }).eq("user_id", fromId));
    }
    if (error) throw new Error(`re-point ${table} failed: ${error.message}`);
    console.log(`  ${table.padEnd(22)} ${n} → moved`);
    moved += n;
  }

  if (!args.dryRun) {
    // Fold the dev profile's earned state into the real profile, then remove it.
    const merge = await db
      .from("users_profile")
      .update({
        streak_count: dev.streak_count,
        streak_freezes: dev.streak_freezes,
        last_active_date: dev.last_active_date,
        plan: dev.plan,
      })
      .eq("id", toId);
    if (merge.error) throw new Error(`profile merge failed: ${merge.error.message}`);

    const delProfile = await db.from("users_profile").delete().eq("id", fromId);
    if (delProfile.error) throw new Error(`delete dev profile failed: ${delProfile.error.message}`);
    console.log(`\n  users_profile          dev row merged (streak ${dev.streak_count}, plan ${dev.plan}) + deleted`);
  }

  console.log(`\nDone. ${args.dryRun ? "Would move" : "Moved"} ${moved} row(s).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nmigrate:dev-user failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
