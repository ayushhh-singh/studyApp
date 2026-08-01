/**
 * Dev-only convenience: run the current-affairs pipeline on a schedule inside
 * the already-running API process (via node-cron), so a local `pnpm dev`
 * session keeps the feed fresh without a human remembering to run `pnpm
 * ca:run`. In production this is NOT how the pipeline runs — production uses
 * an external cron-capable host invoking `pnpm ca:run` (or the api package's
 * `ca:run` script) directly as a scheduled job, decoupled from the API
 * process's lifecycle.
 *
 * OPT-IN, NOT AUTOMATIC — see `devSchedulerEnabled` below. "Dev-only" names
 * the PROCESS this runs in, not the DATA it touches: this repo deliberately
 * uses ONE Supabase project for local dev and production (CLAUDE.md →
 * Architecture), so every row this writes is a production row and every LLM
 * call it makes is real money. An idle `pnpm dev` left open overnight would
 * otherwise spend budget and publish content unattended, with nobody watching
 * the log it writes to.
 */
import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { liveExamCodes } from "../lib/exams.js";
import { runPipeline } from "./pipeline.js";
import { assembleWeeklySets } from "./assemble.js";

const DEV_SCHEDULE = "0 */6 * * *"; // every 6 hours
// Weekly assemblies: Monday 06:00 IST — after the weekend's items are triaged
// and (ideally) reviewed. Idempotent per week, so an extra run is harmless.
const WEEKLY_ASSEMBLE_SCHEDULE = "0 6 * * 1";
const IST_TZ = "Asia/Kolkata";

/** The one env var that turns this scheduler on. Documented in apps/api/.env.example. */
const DEV_SCHEDULER_ENV = "CA_DEV_SCHEDULER";

/**
 * Explicit opt-in. Deliberately NOT inferred from anything:
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
 */
function devSchedulerEnabled(): boolean {
  const raw = (process.env[DEV_SCHEDULER_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function startDevCaScheduler(): void {
  if (!devSchedulerEnabled()) {
    // WARN, not debug: turning this off changes behaviour for anyone who was
    // relying on a local `pnpm dev` keeping the feed fresh. They must be able
    // to see why the feed stopped moving without reading this file.
    logger.warn(
      `ca: dev scheduler DISABLED (set ${DEV_SCHEDULER_ENV}=1 to enable). ` +
        `It writes production rows and spends real LLM budget on a 6h cadence, ` +
        `so it is opt-in. Run \`pnpm ca:run\` by hand for a one-off refresh; ` +
        `scheduled production runs come from .github/workflows/ca-run.yml.`,
    );
    return;
  }

  // Same 6h cadence as before; it just inherits the pipeline's default batch
  // mode now. Each tick COLLECTS the previous tick's triage batch (running the
  // full downstream for those items) and SUBMITS a new one without waiting, so
  // a fresh item goes live within roughly one cadence at half the triage cost.
  //
  // IST, like every other schedule in this codebase. node-cron defaults to the
  // host's local timezone when none is given, so without this the cadence
  // silently tracked whatever clock the machine happened to be on — its sibling
  // below has always passed IST_TZ, and the two must not drift apart.
  cron.schedule(
    DEV_SCHEDULE,
    () => {
      logger.info("ca: scheduled pipeline run starting");
      // Always the LIVE set. A scheduled run must never inherit `ca:run --exam`'s
      // pre-launch override — that flag is for a human building content for an
      // exam nobody can select yet, and a cron doing it silently is exactly the
      // unattended spend the flag's default is designed to prevent.
      liveExamCodes()
        .then((examCodes) =>
          runPipeline({ days: 3, maxPerSource: 15, maxTotal: 40, examCodes }, (msg) => logger.info(`ca: ${msg}`)),
        )
        .then((result) => logger.info({ result }, "ca: scheduled pipeline run finished"))
        .catch((err) => logger.error({ err }, "ca: scheduled pipeline run failed"));
    },
    { timezone: IST_TZ },
  );

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

  logger.warn(
    `ca: dev scheduler ENABLED via ${DEV_SCHEDULER_ENV} (pipeline "${DEV_SCHEDULE}" IST, ` +
      `weekly assembly "${WEEKLY_ASSEMBLE_SCHEDULE}" IST). This process will write ` +
      `production rows and spend real LLM budget while it stays up.`,
  );
}
