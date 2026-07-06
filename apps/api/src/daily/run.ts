/**
 * `pnpm daily:build [--date YYYY-MM-DD] [--size N] [--user <uuid>]`
 *
 * Assembles the day's engagement content: the daily quiz today (the daily
 * answer set is added by its own builder). Invoked by the 5:00 AM IST scheduler
 * (daily/scheduler.ts) and runnable by hand for a specific date. Idempotent —
 * re-running a date rebuilds that day's content in place.
 */
import { devUserId } from "../lib/dev-user.js";
import { istToday } from "../lib/ist.js";
import { logger } from "../lib/logger.js";
import { buildDailyQuiz } from "./quiz.js";

export interface DailyBuildOptions {
  date?: string;
  size?: number;
  userId?: string;
  log?: (msg: string) => void;
}

export async function runDailyBuild(opts: DailyBuildOptions = {}): Promise<void> {
  const date = opts.date ?? istToday();
  const userId = opts.userId ?? devUserId();
  const log = opts.log ?? ((m: string) => logger.info(`daily: ${m}`));

  log(`building daily content for ${date}`);
  const quiz = await buildDailyQuiz({ userId, date, size: opts.size, log });
  if (!quiz) log("daily quiz: skipped (no questions available)");
}

function parseArgs(argv: string[]): DailyBuildOptions {
  const opts: DailyBuildOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") opts.date = argv[++i];
    else if (a === "--size") opts.size = Number(argv[++i]);
    else if (a === "--user") opts.userId = argv[++i];
  }
  return opts;
}

// Run as a CLI only when invoked directly (not when imported by the scheduler).
const invokedDirectly = process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js");
if (invokedDirectly) {
  runDailyBuild({ ...parseArgs(process.argv.slice(2)), log: (m) => console.log(`daily: ${m}`) })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\ndaily:build failed:", err instanceof Error ? err.stack : err);
      process.exit(1);
    });
}
