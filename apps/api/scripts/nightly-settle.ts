/**
 * `pnpm nightly:settle` — standalone entrypoint for production's external
 * cron. Mirrors STREAK_NIGHTLY_CRON's per-user callback in
 * src/daily/scheduler.ts exactly (that scheduler only runs in dev, gated on
 * NODE_ENV !== "production" in src/index.ts) — this is the same job (streak
 * settle, Perfect Day, mastery recompute, mentor insights) as a one-shot
 * process a platform scheduler (Render/Railway Cron Job) can invoke on its
 * own timetable, decoupled from the API process's lifecycle. Bundled into one
 * script rather than four because that's how the logic is already grouped in
 * daily/scheduler.ts — splitting it would mean maintaining the grouping twice.
 *
 * Schedule this at 00:05 IST (18:35 UTC).
 */
import { forEachUser } from "../src/lib/users.js";
import { runStreakNightly } from "../src/daily/streak.js";
import { recordPerfectDay } from "../src/services/daily-stats.js";
import { recomputeMastery } from "../src/mastery/compute.js";
import { computeLearnerProfile } from "../src/services/learner-profile.js";
import { generateMentorInsights } from "../src/services/mentor-insights.js";
import { refreshScoreboardViews } from "../src/services/scoreboard.js";

async function main() {
  // Scoreboard: one global refresh (not per-user), same as scheduler.ts's dev cron.
  await refreshScoreboardViews();
  console.log("scoreboard: nightly refresh done");

  await forEachUser(
    "nightly:settle",
    async (userId) => {
      await runStreakNightly(userId);
      await recordPerfectDay(userId);
      const n = await recomputeMastery(userId);
      console.log(`mastery: recomputed ${n} node(s) for ${userId}`);
      await computeLearnerProfile(userId);
      await generateMentorInsights(userId);
    },
    { throwOnListFailure: true },
  );
  console.log("nightly:settle done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("nightly:settle failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
