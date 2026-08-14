/**
 * `pnpm series:build --slug <s> [--dry-run]`
 *
 *   --slug      the calendar file to build (without .json). Omit to list them.
 *   --dry-run   assemble and report, writing NOTHING. Use this to check whether
 *               a calendar's pools can actually fill it before publishing.
 *   --window N  assemble only papers opening within N days (default 42). The
 *               WHOLE calendar is written either way — dates, syllabus notes and
 *               sources — because that is the published product; only the papers
 *               wait. This is the intended operating mode: put it on a schedule
 *               and each paper materialises against a bank that is months
 *               fresher than the day the calendar went out.
 *   --all       assemble every paper now, regardless of date. Freezes the far
 *               ones against today's bank; use it for a dry-run feasibility
 *               check, not routinely.
 *   --rebuild   replace papers that already exist. Off by default so a re-run
 *               can never change a paper a student may already have sat.
 *
 * ⚑ A BUILD WRITES REAL `tests` ROWS TO THE PRODUCTION DATABASE (this project is
 * the same Supabase project for dev and prod). That is why every flag goes
 * through the shared `parseArgs` with an explicit spec: a valueless `--slug`, a
 * shell-collapsed `"--slug x --dry-run"` single token, or a bare positional each
 * used to produce a silently WIDER or REDIRECTED run, and one of them caused a
 * real billed, production-writing incident (docs/OUTSTANDING.md §0d). The parser
 * rejects all three by name.
 */
import { parseArgs } from "../ingest/_shared.js";
import { buildSeries } from "./build.js";
import { listCalendarSlugs } from "./calendar.js";

const args = parseArgs(
  process.argv.slice(2),
  { value: ["slug"], positiveInt: ["window"], boolean: ["dry-run", "all", "rebuild"] },
  "series:build",
);

const slug = typeof args.slug === "string" ? args.slug : null;
if (!slug) {
  console.log("series:build — available calendars:");
  for (const s of listCalendarSlugs()) console.log(`  ${s}`);
  console.log("\nUsage: pnpm series:build --slug <name> [--window N] [--all] [--rebuild] [--dry-run]");
  process.exit(0);
}

buildSeries(
  slug,
  {
    dryRun: !!args["dry-run"],
    all: !!args.all,
    rebuild: !!args.rebuild,
    ...(typeof args.window === "string" ? { windowDays: Number(args.window) } : {}),
  },
  (m) => console.log(`series: ${m}`),
)
  .then((res) => {
    const worst = res.entries.reduce((a, e) => Math.max(a, e.deviation_pct), 0);
    const reused = res.entries.reduce((a, e) => a + e.reused_from_earlier_entries, 0);
    const total = res.entries.reduce((a, e) => a + e.question_count, 0);
    const backfilled = res.entries.reduce((a, e) => a + e.backfilled, 0);
    console.log(
      `\nseries: ${res.slug} — ${res.entries.length} entries, ${total} question slots, ` +
        `${backfilled} backfilled, ${reused} repeated across entries, worst deviation ${worst.toFixed(1)}pp`,
    );
    if (res.series_id === null) console.log("series: DRY RUN — nothing was written.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nseries:build failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
