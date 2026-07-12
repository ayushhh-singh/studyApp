/**
 * feature-discovery:report — for each of the 12 onboarding-tour pillars, what
 * % of users past their first 7 days have EVER touched it (feature_first_touch,
 * stamped at real usage — see lib/feature-touch.ts). This is how we'll know
 * later whether the 5-layer tour (welcome moment / two-stage checklist /
 * section coachmarks / the permanent /explore page) is actually working,
 * rather than assuming from checklist-completion rate alone — a user can
 * complete the checklist's 9 tasks and still never discover current_affairs
 * or mentor_teach_mode, which aren't checklist items.
 *
 *   pnpm feature-discovery:report [--days N]   (N = cohort age in days, default 7)
 */
import { FEATURE_KEYS, type FeatureKey } from "@prayasup/shared";
import { supabase } from "../src/lib/supabase.js";

const PAGE_SIZE = 1000;

/** PostgREST caps a single response at 1000 rows — page past it, don't silently truncate. */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function parseArgs(argv: string[]): { days: number } {
  let days = 7;
  for (let i = 0; i < argv.length; i++) {
    // `|| 7` would silently discard an explicit `--days 0` (0 is falsy) —
    // check for NaN instead so 0 means "everyone", not "use the default".
    if (argv[i] === "--days") {
      const parsed = Number(argv[++i]);
      days = Number.isNaN(parsed) ? 7 : Math.max(0, parsed);
    }
  }
  return { days };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

async function main(): Promise<void> {
  const { days } = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  const profiles = await fetchAllRows<{ id: string; created_at: string }>((from, to) =>
    supabase().from("users_profile").select("id, created_at").range(from, to),
  );
  const cohort = profiles.filter((p) => Date.parse(p.created_at) <= cutoff.getTime());
  const cohortIds = new Set(cohort.map((p) => p.id));

  console.log("=".repeat(80));
  console.log(`Feature discovery — cohort: signed up ${days}+ days ago (${cohort.length} of ${profiles.length} users)`);
  console.log("=".repeat(80));

  if (cohort.length === 0) {
    console.log("No users old enough for this cohort yet — nothing to report.");
    return;
  }

  const touches = await fetchAllRows<{ user_id: string; feature_key: string }>((from, to) =>
    supabase().from("feature_first_touch").select("user_id, feature_key").range(from, to),
  );

  const touchedBy = new Map<FeatureKey, Set<string>>(FEATURE_KEYS.map((k) => [k, new Set<string>()]));
  for (const row of touches) {
    if (!cohortIds.has(row.user_id)) continue; // touched, but outside the cohort window
    const set = touchedBy.get(row.feature_key as FeatureKey);
    if (set) set.add(row.user_id);
  }

  const header = ["feature".padEnd(20), "touched".padStart(9), "%".padStart(6)].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  const rates = FEATURE_KEYS.map((key) => {
    const touched = touchedBy.get(key)?.size ?? 0;
    return { key, touched, rate: touched / cohort.length };
  }).sort((a, b) => a.rate - b.rate);

  for (const r of rates) {
    console.log([r.key.padEnd(20), `${r.touched}/${cohort.length}`.padStart(9), fmtPct(r.rate).padStart(6)].join(" "));
  }
  console.log("-".repeat(header.length));

  const undiscovered = rates.filter((r) => r.rate < 0.2);
  if (undiscovered.length > 0) {
    console.log("\nLeast-discovered features (< 20% of the cohort has ever touched):");
    for (const r of undiscovered) console.log(`   - ${r.key}: ${fmtPct(r.rate)}`);
    console.log("   → candidates for a stronger /explore placement or a new section coachmark.");
  } else {
    console.log("\nEvery pillar has reached at least 20% of the cohort.");
  }
}

main().catch((err) => {
  console.error("\nfeature-discovery:report failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
