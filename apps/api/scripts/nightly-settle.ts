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
import { pruneAbandonedGuests } from "../src/services/guest-cleanup.js";
import { backfillCardOriginNodes, refreshQuestionCardBacks } from "../src/services/srs.js";

async function main() {
  // Scoreboard: one global refresh (not per-user), same as scheduler.ts's dev cron.
  await refreshScoreboardViews();
  console.log("scoreboard: nightly refresh done");

  // Prune abandoned anonymous (guest) accounts (global, not per-user). Only old
  // AND inactive guests; converted/real accounts are never touched.
  try {
    const p = await pruneAbandonedGuests({ apply: true });
    console.log(`guests: pruned ${p.pruned} abandoned (of ${p.eligible} eligible / ${p.oldAnonymous} old, retention ${p.retentionDays}d)`);
  } catch (err) {
    // Non-fatal: never let guest cleanup block the streak/mastery settle below.
    console.error("guests: prune failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Revision cards snapshot their question's explanation at add time, and most of
  // the bank has no explanation until someone first views the question — so a card
  // added while its question was bare stays answer-only unless something re-derives
  // it. Global (one pass over all question cards), not per-user, since it reads the
  // shared question bank once. Same "nightly net for what gets forgotten" role as
  // ingest:embed --missing-only, and non-fatal for the same reason as the prune.
  try {
    const r = await refreshQuestionCardBacks({ apply: true });
    console.log(
      `srs: refreshed ${r.refreshed} card back(s) of ${r.scanned} scanned ` +
        `(${r.skippedEdited} hand-edited, ${r.danglingSource} with a deleted source question)`,
    );
    // Repairs `origin_node_id` (0132) for cards whose write path could not
    // resolve one, and recovers the sha256-derived note-card ids SQL cannot
    // reverse. Idempotent — it only ever looks at cards that still have none.
    const o = await backfillCardOriginNodes({ apply: true });
    console.log(`srs: resolved ${o.resolved} card origin(s) of ${o.missing} missing`);
  } catch (err) {
    console.error("srs: card-back refresh failed (non-fatal):", err instanceof Error ? err.message : err);
  }

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
