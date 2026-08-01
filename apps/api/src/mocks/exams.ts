/**
 * Exam selection shared by `mocks:build` and `mocks:build:mains`.
 *
 * Lives in its own module rather than being copied into both CLIs: the two are
 * separate steps of the SAME monthly workflow (`.github/workflows/
 * mocks-build.yml` runs them back to back), and a policy that drifted between
 * them would rebuild one stage for a different exam set than the other.
 */
import type { FlagSpec } from "../ingest/_shared.js";
import { listExams } from "../lib/exams.js";

/** Both mock CLIs accept exactly one flag. */
export const MOCK_BUILD_FLAGS: FlagSpec = { value: ["exam"] };

/**
 * Which exams get their mocks rebuilt. Modelled on `qgen/cli.ts`'s
 * `resolveTopupExams` (3a99d1a) rather than inventing a second pattern for the
 * same decision.
 *
 * DEFAULT = every LIVE exam. A reference exam (`upsc` and `mppsc` today,
 * `exams.is_live = false`) is one no user can select, so rebuilding its mocks on
 * the monthly cron writes real `tests` + `test_questions` rows for papers nobody
 * can reach. Measured today the live set is exactly `["uppsc"]`, so
 * `.github/workflows/mocks-build.yml` — which passes no `--exam` — rebuilds
 * EXACTLY the papers it rebuilt before this change.
 *
 * `--exam <code>` is the explicit override and MAY name a non-live exam on
 * purpose: building a bank's mocks before launch is the real use case. It is
 * validated against the registry rather than passed through, because an unknown
 * code would otherwise resolve to zero papers and exit 0 having silently done
 * nothing — indistinguishable from a successful rebuild.
 */
export async function resolveMockBuildExams(
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
    if (!hit.is_live) {
      // Not an error — but never silent.
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
