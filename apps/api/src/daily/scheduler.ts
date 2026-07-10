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
import { runPushSender } from "../push/sender.js";
import { recomputeMastery } from "../mastery/compute.js";
import { recordPerfectDay } from "../services/daily-stats.js";
import { computeLearnerProfile } from "../services/learner-profile.js";
import { generateMentorInsights } from "../services/mentor-insights.js";
import { refreshScoreboardViews } from "../services/scoreboard.js";
import { forEachUser } from "../lib/users.js";

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
      // Scoreboard: one global refresh (not per-user) — mv_test_leaderboard /
      // mv_mock_series_board / mv_mains_weekly_board + rank snapshots.
      void refreshScoreboardViews()
        .then(() => logger.info("scoreboard: nightly refresh finished"))
        .catch((err) => logger.error({ err }, "scoreboard: nightly refresh failed"));

      void forEachUser("daily: nightly settle", async (userId) => {
        await runStreakNightly(userId);
        // Settle yesterday's Perfect Day before the IST date rolls fully over.
        await recordPerfectDay(userId);
        // Nightly mastery settle — recency decay means an untouched node's score
        // must fall even with no new activity, so recompute keeps levels honest.
        const n = await recomputeMastery(userId);
        logger.info(`mastery: nightly recompute updated ${n} node(s) for ${userId}`);
        // Refresh the learner profile, then derive today's proactive mentor
        // insight cards from it (both idempotent).
        await computeLearnerProfile(userId);
        await generateMentorInsights(userId);
      });
    },
    { timezone: IST_TZ },
  );

  cron.schedule(
    NOTIFICATIONS_CRON,
    () => {
      void forEachUser("daily: notification generation", (userId) => generateForUser(userId)).then(() =>
        runPushSender().catch((err) => logger.error({ err }, "daily: push sender failed")),
      );
    },
    { timezone: IST_TZ },
  );

  logger.info(
    `daily: scheduler started (build "${DAILY_BUILD_CRON}" IST, streak "${STREAK_NIGHTLY_CRON}" IST, notifications "${NOTIFICATIONS_CRON}" IST)`,
  );
}
