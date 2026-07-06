/**
 * Dev-only convenience: run the daily-content build at 5:00 AM IST inside the
 * already-running API process (node-cron), so a local `pnpm dev` session always
 * has today's quiz + answer set without a human running `pnpm daily:build`.
 *
 * Production does NOT build content this way — an external cron-capable host
 * invokes `pnpm daily:build` as a scheduled job, decoupled from the API
 * process's lifecycle (same policy as the current-affairs scheduler).
 *
 * node-cron evaluates the expression in the given IANA timezone, so 5:00 AM IST
 * fires correctly regardless of the server's own clock.
 */
import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { runDailyBuild } from "./run.js";
import { runStreakNightly } from "./streak.js";
import { generateForUser } from "../services/notifications.js";
import { devUserId } from "../lib/dev-user.js";

const DAILY_BUILD_CRON = "0 5 * * *"; // 05:00 every day
const STREAK_NIGHTLY_CRON = "5 0 * * *"; // 00:05 every day — settle the streak just after IST midnight
const NOTIFICATIONS_CRON = "0 * * * *"; // hourly — (re)generate/resolve nudges (incl. the ~8 PM streak-at-risk)
const IST_TZ = "Asia/Kolkata";

export function startDailyScheduler(): void {
  cron.schedule(
    DAILY_BUILD_CRON,
    () => {
      logger.info("daily: 5:00 AM IST build starting");
      runDailyBuild()
        .then(() => logger.info("daily: scheduled build finished"))
        .catch((err) => logger.error({ err }, "daily: scheduled build failed"));
    },
    { timezone: IST_TZ },
  );

  cron.schedule(
    STREAK_NIGHTLY_CRON,
    () => {
      runStreakNightly().catch((err) => logger.error({ err }, "daily: nightly streak settle failed"));
    },
    { timezone: IST_TZ },
  );

  cron.schedule(
    NOTIFICATIONS_CRON,
    () => {
      generateForUser(devUserId()).catch((err) => logger.error({ err }, "daily: notification generation failed"));
    },
    { timezone: IST_TZ },
  );

  logger.info(
    `daily: scheduler started (build "${DAILY_BUILD_CRON}" IST, streak "${STREAK_NIGHTLY_CRON}" IST, notifications "${NOTIFICATIONS_CRON}" IST)`,
  );
}
