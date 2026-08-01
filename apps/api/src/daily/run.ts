/**
 * `pnpm daily:build [--date YYYY-MM-DD] [--size N] [--user <uuid>] [--exam <code>]`
 *
 * Assembles the day's engagement content: the daily quiz today (the daily
 * answer set is added by its own builder). Invoked by the 5:00 AM IST scheduler
 * (daily/scheduler.ts) and runnable by hand for a specific date. Idempotent —
 * re-running a date rebuilds that day's content in place.
 */
import { parseArgs } from "../ingest/_shared.js";
import { istToday } from "../lib/ist.js";
import { logger } from "../lib/logger.js";
import { listAllUserIds } from "../lib/users.js";
import { listExams } from "../lib/exams.js";
import { buildDailyQuizzes } from "./quiz.js";
import { variantsForExam } from "./config.js";
import { getDailyAnswerSet } from "../services/answer-set.js";

export interface DailyBuildOptions {
  date?: string;
  size?: number;
  /** Build for one user; omit to build for every onboarded user. */
  userId?: string;
  /**
   * Which exams' daily quizzes to build. REQUIRED — see
   * `BuildDailyQuizOptions.examCodes`. `resolveDailyBuildExams` below is the
   * one place the default ("every live exam") is decided.
   */
  examCodes: string[];
  log?: (msg: string) => void;
}

/**
 * Which exams tonight's build covers. THE EXAM-SELECTION POLICY LIVES HERE,
 * deliberately, and mirrors `qgen/cli.ts`'s `resolveTopupExams` rather than
 * inventing a second pattern for the same decision.
 *
 * DEFAULT = every LIVE exam, not every exam with configured variants. A
 * reference exam (`upsc` today, `exams.is_live = false`) is one no user can
 * select, so building it nightly writes real `tests` + `test_questions` rows
 * for a quiz nobody can reach. Measured today the live set is exactly
 * `["uppsc"]`, so the 5:00 AM scheduler and a bare `pnpm daily:build` build
 * EXACTLY the two quizzes they built before this change.
 *
 * `--exam <code>` is the explicit override, and it may name a NON-live exam on
 * purpose: exercising a quiz before launch is the real use case. Validated
 * against the registry rather than passed through — an unknown code would
 * otherwise silently resolve to zero variants and exit 0 having done nothing,
 * which is indistinguishable from a successful run.
 */
export async function resolveDailyBuildExams(
  examArg: string | boolean | undefined,
  log: (m: string) => void,
): Promise<string[]> {
  const registry = await listExams();

  if (typeof examArg === "string") {
    const hit = registry.find((e) => e.exam_code === examArg);
    if (!hit) {
      const codes = registry.map((e) => e.exam_code).sort().join(", ");
      throw new Error(`Unknown --exam "${examArg}". Registered exams: ${codes}`);
    }
    if (variantsForExam(examArg).length === 0) {
      throw new Error(`--exam ${examArg}: this exam has no daily-quiz variants configured (daily/config.ts).`);
    }
    if (!hit.is_live) {
      // Not an error — but never silent. Building for an unselectable exam is a
      // deliberate pre-launch act, and the operator should see that it was.
      log(`--exam ${examArg}: this exam is NOT live (no user can select it yet) — building anyway, as explicitly named.`);
    }
    return [examArg];
  }

  const live = registry.filter((e) => e.is_live).map((e) => e.exam_code);
  if (live.length === 0) {
    throw new Error("No exam has exams.is_live = true, so there is nothing to build. Pass --exam <code> to override.");
  }
  return live;
}

export async function runDailyBuild(opts: DailyBuildOptions): Promise<void> {
  const date = opts.date ?? istToday();
  const log = opts.log ?? ((m: string) => logger.info(`daily: ${m}`));

  // The daily quizzes are SHARED tests (one GS + one CSAT per exam for the whole
  // platform, not per-user) — services/scoreboard.ts ranks every user's GS
  // attempt against everyone else's via daily_quiz_board_entries, which only
  // makes sense if they all took the same set. Build them once, not once per
  // user. Each variant is assembled from its own paper's pool (see
  // daily/quiz.ts / config.ts).
  const planned = opts.examCodes.flatMap((e) => variantsForExam(e).map((v) => `${e}:${v.key}`));
  log(`building daily quizzes (${planned.join(", ") || "none configured"}) for ${date}`);
  const quizzes = await buildDailyQuizzes({ date, size: opts.size, examCodes: opts.examCodes, log });
  for (const q of quizzes) {
    if (!q.result) log(`daily quiz [${q.examCode}:${q.variant}]: skipped (no questions available)`);
  }

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

// Run as a CLI only when invoked directly (not when imported by the scheduler).
const invokedDirectly = process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js");
if (invokedDirectly) {
  const args = parseArgs(
    process.argv.slice(2),
    // `size` is a positiveInt, and that is what fixes a real silent-NaN path:
    // it flows to clampSize(opts.size ?? cfg.defaultSize, cfg) and `??` does
    // NOT catch NaN, so `--size abc` (or a valueless `--size`, which the old
    // exact-match parser turned into Number(undefined) === NaN) used to
    // propagate NaN through the whole quiz build. It is now rejected at parse.
    { value: ["date", "user", "exam"], positiveInt: ["size"] },
    "daily:build",
  );

  // Built EXPLICITLY rather than spread into runDailyBuild(). The shared parser
  // returns a Record keyed by RAW FLAG NAMES with STRING values, so the old
  // `{ ...parseArgs(...) }` spread would now silently pass `user` (not the
  // `userId` option this function reads, so --user would be dropped and the
  // build would fan out to EVERY onboarded user) and a string `size` where a
  // number is required. Keys stay conditional so an omitted flag remains
  // `undefined`, exactly as before.
  const log = (m: string) => console.log(`daily: ${m}`);
  const opts: DailyBuildOptions = { examCodes: [], log };
  if (typeof args.date === "string") opts.date = args.date;
  if (typeof args.size === "string") opts.size = Number(args.size);
  if (typeof args.user === "string") opts.userId = args.user;

  resolveDailyBuildExams(args.exam, log)
    .then((examCodes) => runDailyBuild({ ...opts, examCodes }))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\ndaily:build failed:", err instanceof Error ? err.stack : err);
      process.exit(1);
    });
}
