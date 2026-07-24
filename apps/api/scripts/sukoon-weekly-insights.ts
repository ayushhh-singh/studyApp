/**
 * `pnpm sukoon:weekly-insights` — the Sunday weekly-insights job (Sukoon F9),
 * a one-shot process a scheduler (GitHub Actions — see
 * .github/workflows/sukoon-weekly-insights.yml) invokes. For every Plus+ user
 * who has insights_opt_in on and enough of a week to reflect on, it generates
 * one insight (Sonnet, cost-logged, idempotent per week) and queues a push.
 *
 * Flags:
 *   --dry-run          Generate + PRINT one/all insights but DON'T persist or push.
 *   --week YYYY-MM-DD   Override the week's Monday (default: the current IST week).
 *   --user <uuid>       Only this user (testing).
 *   --limit N           Cap the number of users processed (testing).
 *   --force             Regenerate even if the week's insight already exists.
 *
 * Idempotent: generateWeeklyInsight skips an already-generated week unless
 * --force, so a re-run (or a retried Actions job) never double-bills or dupes.
 */
import { supabase } from "../src/lib/supabase.js";
import { logger } from "../src/lib/logger.js";
import { pushConfigured, sendPush } from "../src/lib/push.js";
import {
  currentWeekStart,
  generateWeeklyInsight,
  weekStartMonday,
} from "../src/sukoon/services/insights.js";

interface Args {
  dryRun: boolean;
  force: boolean;
  week: string;
  user?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const weekArg = get("--week");
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    week: weekArg ? weekStartMonday(weekArg) : currentWeekStart(),
    user: get("--user"),
    limit: get("--limit") ? Number(get("--limit")) : undefined,
  };
}

/** Candidate users: onboarded, insights opted-in. Tier/data gates run per-user. */
async function candidateUserIds(args: Args): Promise<string[]> {
  if (args.user) return [args.user];
  const { data, error } = await supabase()
    .from("sukoon_profiles")
    .select("user_id")
    .eq("onboarding_completed", true)
    .eq("insights_opt_in", true);
  if (error) throw new Error(`candidate list failed: ${error.message}`);
  const ids = ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  return args.limit != null ? ids.slice(0, args.limit) : ids;
}

/** Best-effort push of a fresh insight; prunes subscriptions the service reports gone. */
async function pushInsight(userId: string, language: string): Promise<void> {
  if (!pushConfigured()) return;
  const hi = language === "hi" || language === "hinglish";
  const payload = {
    title: hi ? "आपकी इस हफ़्ते की झलक तैयार है 🌱" : "Your weekly reflection is ready 🌱",
    body: hi
      ? "Sukoon ने आपके हफ़्ते पर एक गर्मजोशी भरी झलक लिखी है।"
      : "Sukoon has written a warm reflection on your week.",
    link: "/sukoon/you",
    tag: "sukoon_weekly_insight",
  };
  const { data } = await supabase()
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("user_id", userId);
  const subs = (data as { id: string; endpoint: string; p256dh: string; auth_key: string }[] | null) ?? [];
  const gone: string[] = [];
  for (const s of subs) {
    const res = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, authKey: s.auth_key }, payload);
    if (res === "gone") gone.push(s.id);
  }
  if (gone.length) await supabase().from("push_subscriptions").delete().in("id", gone);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const users = await candidateUserIds(args);
  logger.info(
    { week: args.week, users: users.length, dryRun: args.dryRun, force: args.force },
    "sukoon weekly-insights: starting",
  );

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let costUsd = 0;
  const reasons: Record<string, number> = {};

  for (const userId of users) {
    try {
      const outcome = await generateWeeklyInsight(userId, args.week, {
        dryRun: args.dryRun,
        force: args.force,
      });
      if (outcome.status === "generated") {
        generated++;
        costUsd += outcome.costUsd;
        // Fetch language for the push copy without another round-trip cost.
        const { data: p } = await supabase()
          .from("sukoon_profiles")
          .select("language")
          .eq("user_id", userId)
          .maybeSingle();
        await pushInsight(userId, (p as { language: string } | null)?.language ?? "hi");
      } else if (outcome.status === "dry_run") {
        generated++;
        console.log(`\n=== ${userId} (week ${args.week}) ===`);
        console.log("SUMMARY:", outcome.content.summary);
        console.log("SUGGESTION:", outcome.content.suggestion);
        console.log("JOURNEY:", outcome.content.journey_slug ?? "(none)", "—", outcome.content.journey_reason);
      } else {
        skipped++;
        reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;
      }
    } catch (err) {
      // One user's failure must never abort the whole run (best-effort weekly job).
      failed++;
      logger.error({ userId, err: err instanceof Error ? err.message : err }, "insight generation failed");
    }
  }

  logger.info(
    { generated, skipped, failed, reasons, costUsd: Math.round(costUsd * 10000) / 10000 },
    "sukoon weekly-insights: done",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sukoon:weekly-insights failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
