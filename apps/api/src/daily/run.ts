/**
 * `pnpm daily:build [--date YYYY-MM-DD] [--size N] [--user <uuid>] [--exam <code>]`
 *
 * Assembles the day's engagement content: the GS/CSAT daily quizzes and the
 * daily current-affairs sets (the daily answer set is computed on demand by its
 * own builder — the check below is diagnostic). Invoked by the 5:00 AM IST
 * scheduler (daily/scheduler.ts) and runnable by hand for a specific date.
 * Idempotent — re-running a date rebuilds/returns that day's content in place.
 */
import { parseArgs } from "../ingest/_shared.js";
import { istToday } from "../lib/ist.js";
import { logger } from "../lib/logger.js";
import { listAllUserIds } from "../lib/users.js";
import { listExams } from "../lib/exams.js";
import { buildDailyQuizzes } from "./quiz.js";
import { variantsForExam } from "./config.js";
import { assembleDailyCaSets, assembleWeeklySets } from "../ca/assemble.js";
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

  // The daily current-affairs sets, built HERE rather than on their own cron so
  // both daily cadences resolve "today" and "which exams" once, from the same
  // options. Deliberately NOT wrapped in try/catch: it is pure DB work over
  // already-approved questions, so a failure is a real fault the operator must
  // see as a red run — and the only step below it is the diagnostic answer-set
  // check, which stores nothing.
  const caRun = await assembleDailyCaSets({ date, examCodes: opts.examCodes });
  for (const r of caRun.results) {
    log(
      `daily CA sets [${r.examCode}]: prelims ${r.prelimsTestId ?? "— (nothing new approved)"}, ` +
        `mains ${r.mainsTestId ?? "— (nothing new approved)"}`,
    );
  }

  // Gap-filler for the WEEKLY sets. Their own cron (Monday, ca-assemble.yml)
  // remains the generator; this only ensures the week's set EXISTS, because a
  // single missed Monday would otherwise leave the Current Affairs page empty
  // for a full week with nothing to notice it.
  //
  // Safe to run any day precisely BECAUSE the weekly pool is week-anchored
  // (ca/assemble.ts `dayWindow(weekStart, …)`): a Tuesday heal produces the
  // same set Monday would have, so "generated on a fixed day" still holds — the
  // set's CONTENT depends on which week it is, not on when the build ran. The
  // builder short-circuits on a slug hit, so the normal case is two cheap reads.
  const weeklyRun = await assembleWeeklySets({ examCodes: opts.examCodes });
  for (const r of weeklyRun.results) {
    const built = [r.prelimsTestId, r.mainsTestId].filter(Boolean).length;
    log(`weekly CA sets [${r.examCode}] week of ${r.weekStart}: ${built}/2 present`);
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
