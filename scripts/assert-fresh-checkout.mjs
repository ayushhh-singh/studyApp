/**
 * Stale-checkout guard for SCHEDULED pipeline workflows.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-01 the live current-affairs feed was found contaminated with
 * cross-exam syllabus mappings. The code on the working branch had been fixed
 * days earlier. The pipeline was not running that code.
 *
 * A GitHub Actions `schedule:` trigger always runs from the repository's
 * DEFAULT branch, and `actions/checkout@v4` with no `ref:` checks out that same
 * default branch. So `.github/workflows/ca-run.yml` was faithfully running
 * `pnpm ca:run` — against `main`, frozen at a commit from four days earlier that
 * still called `loadSyllabusCandidates()` with no exam filter and showed the
 * model a whole two-exam syllabus tree inside one single-exam prompt. Nothing
 * failed. Every run was green. The job did exactly what it was told, with the
 * wrong code, and the only symptom was in the data.
 *
 * THE TRAP THIS GUARD CANNOT ESCAPE, AND WHY IT SHAPES THE DESIGN
 * ---------------------------------------------------------------
 * The workflow file and the checked-out source come from the SAME commit. So
 * any guard of the form "the workflow asserts the code contains marker X" is
 * self-consistent by construction: a stale default branch carries a stale
 * assertion checking a stale marker, and passes. You cannot detect stale code
 * using only that stale code. A version/contract file, a sentinel string, a
 * grep for the fix — all of them pass on the very commit they are meant to
 * catch.
 *
 * That rules out every marker-based scheme and leaves exactly two references
 * outside the commit: another branch, or the clock.
 *
 *   - Another branch means naming one (`ref: feature/UPSC`, or "diff against
 *     branch Y"). That rots the moment work moves, and worse, it leaves the
 *     default branch a latent trap for every workflow that did not get pinned.
 *   - The clock does not rot, is not a name, and needs no upkeep.
 *
 * So: this asserts the checked-out commit is not older than MAX_AGE_DAYS. It
 * detects the general condition "the branch these pipelines run from has stopped
 * moving while development continued elsewhere" without knowing anything about
 * what the fix was or which branch has it.
 *
 * HONEST LIMITS — read before trusting it
 * ---------------------------------------
 * 1. It is a BACKSTOP, not a tripwire. At a 14-day threshold it would NOT have
 *    caught the 2026-08-01 incident (the default branch was 4 days stale); it
 *    would have fired on ~2026-08-11. It bounds how long this class of failure
 *    can run unnoticed. It does not prevent it.
 * 2. It only takes effect once it is ON THE DEFAULT BRANCH, because that is the
 *    copy a scheduled run executes. Adding it on a feature branch changes
 *    nothing until that branch is merged. That merge is the operator's call.
 * 3. It cannot tell "deliberately frozen release branch" from "forgotten
 *    branch". A genuinely stable repo that goes quiet for longer than the
 *    threshold will trip it. Tune MAX_COMMIT_AGE_DAYS in the workflow rather
 *    than deleting the step — a threshold you raised on purpose is still a
 *    guard; a deleted one is the original silent failure.
 *
 * WHY IT DOES NOT RUN ON workflow_dispatch
 * ----------------------------------------
 * A manual dispatch lets a human pick the ref, so an old ref there is a choice,
 * not an accident. Blocking it would also remove the operator's own recovery
 * path: if the default branch IS stale, a manual run from a good ref is exactly
 * how you fix the data while the merge is being decided. The workflows gate this
 * step on `github.event_name == 'schedule'` for that reason.
 */
import { execFileSync } from "node:child_process";

const DEFAULT_MAX_AGE_DAYS = 14;

const raw = (process.env.MAX_COMMIT_AGE_DAYS ?? "").trim();
const maxAgeDays = raw === "" ? DEFAULT_MAX_AGE_DAYS : Number(raw);
if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
  console.error(`✗ Stale-checkout guard: MAX_COMMIT_AGE_DAYS must be a positive number, got "${raw}".`);
  process.exit(1);
}

/**
 * Fail rather than skip when the commit date is unreadable. A guard that cannot
 * run has to say so — silently passing is the exact failure mode being fixed.
 */
function readHeadCommit() {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct%n%H%n%cI%n%s", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [ts, sha, iso, ...subject] = out.trim().split("\n");
    const seconds = Number(ts);
    if (!Number.isFinite(seconds)) throw new Error(`unparseable commit timestamp: "${ts}"`);
    return { seconds, sha, iso, subject: subject.join("\n") };
  } catch (err) {
    console.error("");
    console.error("✗ Stale-checkout guard: could not read the checked-out commit date from git.");
    console.error("");
    console.error("  This step runs after actions/checkout, which leaves a .git directory even at");
    console.error("  the default fetch-depth of 1, so this normally cannot happen. Failing rather");
    console.error("  than skipping: an unverifiable checkout must not silently run a billed,");
    console.error("  production-writing pipeline.");
    console.error("");
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error("");
    process.exit(1);
  }
}

const head = readHeadCommit();
const ageDays = (Date.now() / 1000 - head.seconds) / 86400;
const ageText = `${ageDays.toFixed(1)} day(s)`;

if (ageDays > maxAgeDays) {
  console.error("");
  console.error("✗ Stale-checkout guard: this scheduled job is about to run code that looks abandoned.");
  console.error("");
  console.error(`  Checked-out commit : ${head.sha}`);
  console.error(`  Committed          : ${head.iso}  (${ageText} ago)`);
  console.error(`  Subject            : ${head.subject}`);
  console.error(`  Ref                : ${process.env.GITHUB_REF ?? "(unknown)"}`);
  console.error(`  Allowed age        : ${maxAgeDays} day(s)`);
  console.error("");
  console.error("  A scheduled workflow ALWAYS runs from the repository's default branch, and this");
  console.error("  repo's checkout step names no `ref:` — so this is the default branch, and it has");
  console.error("  not moved in a while. If development has continued on another branch, this job");
  console.error("  has been running old code on a live schedule with nothing to show for it but");
  console.error("  wrong data (see the header of scripts/assert-fresh-checkout.mjs).");
  console.error("");
  console.error("  Fix by making the default branch current — merge the branch these pipelines are");
  console.error("  meant to run. That is a deploy decision, so this guard stops the job and asks");
  console.error("  rather than guessing a ref for you.");
  console.error("");
  console.error("  If the default branch is deliberately frozen and correct, raise");
  console.error("  MAX_COMMIT_AGE_DAYS on this step. Do not delete the step: an unbounded stale");
  console.error("  branch is what caused the incident this guard exists for.");
  console.error("");
  console.error("  A one-off run from a known-good ref is still available via workflow_dispatch,");
  console.error("  which this guard deliberately does not block.");
  console.error("");
  process.exit(1);
}

console.log(
  `✓ Stale-checkout guard: HEAD ${head.sha.slice(0, 8)} is ${ageText} old ` +
    `(limit ${maxAgeDays}); running pipeline code from ${process.env.GITHUB_REF ?? "the checked-out ref"}.`,
);
