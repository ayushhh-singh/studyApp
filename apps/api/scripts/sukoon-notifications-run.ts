/**
 * `pnpm sukoon:notifications:run` — standalone entrypoint for the Sukoon
 * reminder cron (mood check-in / journey step / exam-eve support ping,
 * blueprint F11). Mirrors scripts/notifications-run.ts's shape, but is its
 * own script rather than a shared call site: Sukoon's user set
 * (sukoon_profiles) and reminder rules are entirely independent of Neev's
 * notification_schedule/generateForUser.
 *
 * Schedule hourly (see .github/workflows/sukoon-notifications.yml — same
 * cadence/rationale as Neev's own notifications.yml: arbitrary user-chosen
 * reminder times plus a couple of fixed evening pings only need an hour's
 * slack, never a per-minute clock).
 */
import { runSukoonReminders } from "../src/sukoon/services/reminders.js";

async function main() {
  const result = await runSukoonReminders();
  if (result.quiet_hours) {
    console.log("sukoon:notifications:run: quiet hours (11pm–7am IST) — skipped");
    return;
  }
  console.log(`sukoon:notifications:run: processed ${result.processed} users`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sukoon:notifications:run failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
