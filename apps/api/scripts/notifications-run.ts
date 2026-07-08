/**
 * `pnpm notifications:run` — standalone entrypoint for production's external
 * cron. Mirrors NOTIFICATIONS_CRON's callback in src/daily/scheduler.ts (dev
 * only, gated on NODE_ENV !== "production"): (re)generate/resolve each user's
 * notification_schedule rows, then drain them through the web-push sender.
 * `pnpm push:send` (scripts/send-push.ts) only does the second half — this is
 * the one production's cron should actually invoke.
 *
 * Schedule this hourly (matches the in-app bell's own hourly self-heal).
 */
import { forEachUser } from "../src/lib/users.js";
import { generateForUser } from "../src/services/notifications.js";
import { runPushSender } from "../src/push/sender.js";

async function main() {
  await forEachUser("notifications:run", (userId) => generateForUser(userId));
  const result = await runPushSender();
  console.log(`notifications:run: push sender ${result.sent} sent, ${result.skipped} skipped`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("notifications:run failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
