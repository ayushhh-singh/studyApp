/**
 * `pnpm daily:build [--date YYYY-MM-DD] [--size N] [--user <uuid>]`
 *
 * Assembles the day's engagement content: the daily quiz today (the daily
 * answer set is added by its own builder). Invoked by the 5:00 AM IST scheduler
 * (daily/scheduler.ts) and runnable by hand for a specific date. Idempotent —
 * re-running a date rebuilds that day's content in place.
 */
import { istToday } from "../lib/ist.js";
import { logger } from "../lib/logger.js";
import { listAllUserIds } from "../lib/users.js";
import { buildDailyQuiz } from "./quiz.js";
import { getDailyAnswerSet } from "../services/answer-set.js";

export interface DailyBuildOptions {
  date?: string;
  size?: number;
  /** Build for one user; omit to build for every onboarded user. */
  userId?: string;
  log?: (msg: string) => void;
}

export async function runDailyBuild(opts: DailyBuildOptions = {}): Promise<void> {
  const date = opts.date ?? istToday();
  const log = opts.log ?? ((m: string) => logger.info(`daily: ${m}`));

  // The daily quiz is ONE shared test — services/scoreboard.ts ranks every
  // user's attempt on it against everyone else's via
  // daily_quiz_board_entries, which only makes sense if they all took the
  // same set of questions. Build it once, not once per user: it used to run
  // inside the per-user loop below, so every user's build silently
  // overwrote the previous user's membership for the same `tests` row —
  // only whichever user happened to be processed last that night actually
  // determined what everyone saw (and, since the "generated" slice used to
  // draw from a pool filtered to one user's own weak nodes, a real cause of
  // the same handful of questions recurring night after night for
  // everyone). See daily/quiz.ts's doc comment.
  log(`building daily quiz for ${date}`);
  const quiz = await buildDailyQuiz({ date, size: opts.size, log });
  if (!quiz) log("daily quiz: skipped (no questions available)");

  const userIds = opts.userId ? [opts.userId] : await listAllUserIds();
  if (userIds.length === 0) {
    log("no onboarded users — skipping the per-user daily answer set check");
    return;
  }

  for (const userId of userIds) {
    // The answer set (unlike the quiz) is genuinely per-user and computed
    // deterministically on demand (no storage) — verify and log today's
    // composition so the run surfaces any supply gap.
    const answerSet = await getDailyAnswerSet(userId, date);
    log(
      `daily answer set (user ${userId}): ${answerSet.items.length} question(s) — ` +
        answerSet.items.map((i) => `${i.paper_code}(${i.kind})`).join(" "),
    );
  }
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
