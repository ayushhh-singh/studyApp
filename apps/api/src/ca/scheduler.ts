/**
 * Dev-only convenience: run the current-affairs pipeline on a schedule inside
 * the already-running API process (via node-cron), so a local `pnpm dev`
 * session keeps the feed fresh without a human remembering to run `pnpm
 * ca:run`. In production this is NOT how the pipeline runs — production uses
 * an external cron-capable host invoking `pnpm ca:run` (or the api package's
 * `ca:run` script) directly as a scheduled job, decoupled from the API
 * process's lifecycle.
 */
import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { runPipeline } from "./pipeline.js";
import { assembleWeeklySets } from "./assemble.js";

const DEV_SCHEDULE = "0 */6 * * *"; // every 6 hours
// Weekly assemblies: Monday 06:00 IST — after the weekend's items are triaged
// and (ideally) reviewed. Idempotent per week, so an extra run is harmless.
const WEEKLY_ASSEMBLE_SCHEDULE = "0 6 * * 1";
const IST_TZ = "Asia/Kolkata";

export function startDevCaScheduler(): void {
  cron.schedule(DEV_SCHEDULE, () => {
    logger.info("ca: scheduled pipeline run starting");
    runPipeline({ days: 3, maxPerSource: 15, maxTotal: 40 }, (msg) => logger.info(`ca: ${msg}`))
      .then((result) => logger.info({ result }, "ca: scheduled pipeline run finished"))
      .catch((err) => logger.error({ err }, "ca: scheduled pipeline run failed"));
  });

  cron.schedule(
    WEEKLY_ASSEMBLE_SCHEDULE,
    () => {
      logger.info("ca: weekly assembly starting");
      assembleWeeklySets()
        .then((r) => logger.info({ r }, "ca: weekly assembly finished"))
        .catch((err) => logger.error({ err }, "ca: weekly assembly failed"));
    },
    { timezone: IST_TZ },
  );

  logger.info(`ca: dev scheduler started (pipeline "${DEV_SCHEDULE}", weekly assembly "${WEEKLY_ASSEMBLE_SCHEDULE}" IST)`);
}
