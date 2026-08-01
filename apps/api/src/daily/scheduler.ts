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
 *
 * OPT-IN, NOT AUTOMATIC — see `devSchedulerEnabled` below, same treatment as the
 * sibling CA scheduler (ca/scheduler.ts). "Dev-only" names the PROCESS this runs
 * in, not the DATA it touches: this repo deliberately uses ONE Supabase project
 * for local dev and production (CLAUDE.md → Architecture), so every row these
 * three jobs write is a production row — and the hourly one SENDS REAL WEB PUSH
 * NOTIFICATIONS to real users' devices. An idle `pnpm dev` left open for days
 * therefore settled streaks, recomputed mastery and pushed notifications from a
 * developer's laptop, hourly, with nobody watching the log it writes to.
 */
import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { resolveDailyBuildExams, runDailyBuild } from "./run.js";
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
// Every cron.schedule below MUST pass this. node-cron falls back to the host's
// local timezone when no `timezone` option is given, which would silently make
// an IST-named cadence track whatever clock the machine happens to be on. All
// three already do; keep it that way when adding a fourth.
const IST_TZ = "Asia/Kolkata";

/** The one env var that turns this scheduler on. Documented in apps/api/.env.example. */
const DEV_SCHEDULER_ENV = "DAILY_DEV_SCHEDULER";

/**
 * Explicit opt-in, identical in shape to ca/scheduler.ts's gate. Deliberately
 * NOT inferred from anything:
 *
 * - NOT from `NODE_ENV`: it is unset under `pnpm dev`, which is the only
 *   environment this scheduler exists for — "refuse unless NODE_ENV is set"
 *   would refuse everywhere it matters, and "run unless NODE_ENV=production"
 *   is exactly the always-on default being removed here.
 * - NOT from the Supabase URL / any "is this prod?" heuristic: dev and prod
 *   are the SAME project by design, so such a check either always fires or
 *   never does. There is no signal in the connection to read.
 *
 * That leaves a human saying so. Unset means off, and off says so loudly.
 *
 * Its own var rather than sharing CA_DEV_SCHEDULER: the two schedulers carry
 * different risks (CA spends LLM budget; this one writes streak/mastery rows
 * and pushes to real devices), so an operator must be able to opt into one
 * without the other. The duplicated helper is deliberate too — folding both
 * into a shared module would mean editing ca/scheduler.ts, which is a separate
 * concern from closing this exposure.
 */
function devSchedulerEnabled(): boolean {
  const raw = (process.env[DEV_SCHEDULER_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function startDailyScheduler(): void {
  if (!devSchedulerEnabled()) {
    // WARN, not debug: turning this off changes behaviour for anyone who was
    // relying on a local `pnpm dev` producing today's quiz. They must be able
    // to see why the quiz stopped appearing without reading this file.
    logger.warn(
      `daily: dev scheduler DISABLED (set ${DEV_SCHEDULER_ENV}=1 to enable). ` +
        `It writes production rows (daily quiz, streaks, mastery, notifications) ` +
        `and SENDS REAL PUSH NOTIFICATIONS hourly, so it is opt-in. Run ` +
        `\`pnpm daily:build\` / \`pnpm --filter api nightly:settle\` / ` +
        `\`pnpm --filter api notifications:run\` by hand for a one-off; scheduled ` +
        `production runs come from .github/workflows/daily-build.yml, ` +
        `nightly-settle.yml and notifications.yml.`,
    );
    return;
  }

  cron.schedule(
    DAILY_BUILD_CRON,
    () => {
      logger.info("daily: 5:00 AM IST build starting");
      // The scheduled build covers every LIVE exam and nothing else — passing
      // `undefined` takes `resolveDailyBuildExams`' default. A reference exam
      // (is_live = false) is deliberately excluded: nobody can select it, so
      // building it here would write real tests rows for an unreachable quiz.
      // It is still buildable on demand via `pnpm daily:build --exam <code>`.
      resolveDailyBuildExams(undefined, (m) => logger.info(`daily: ${m}`))
        .then((examCodes) => runDailyBuild({ examCodes }))
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

  logger.warn(
    `daily: dev scheduler ENABLED via ${DEV_SCHEDULER_ENV} (build "${DAILY_BUILD_CRON}" IST, ` +
      `streak "${STREAK_NIGHTLY_CRON}" IST, notifications "${NOTIFICATIONS_CRON}" IST). This ` +
      `process will write production rows and send real push notifications to real ` +
      `users' devices while it stays up.`,
  );
}
