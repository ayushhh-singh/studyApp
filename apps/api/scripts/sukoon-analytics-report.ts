/**
 * Session 14 — privacy-aware Sukoon analytics report. Mirrors the reporting
 * CONVENTION this repo already uses for Neev (pnpm cost:report,
 * pnpm feature-discovery:report — a CLI over the raw events table, not a
 * hosted dashboard), applied to sukoon_analytics_events instead of Neev's own
 * `events`/`llm_calls` (never mixed — Sukoon stays self-contained).
 *
 * Reads ONLY name/props/user_id/created_at — never journal/chat/voice
 * content (sukoon_analytics_events structurally cannot carry it; see
 * services/analytics.ts).
 *
 *   pnpm --filter api sukoon:analytics:report [--days N]   (default 30)
 */
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";

interface EventRow {
  user_id: string;
  name: string;
  props: Record<string, unknown>;
  created_at: string;
}

function parseArgs(argv: string[]): { days: number } {
  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") {
      const parsed = Number(argv[++i]);
      days = Number.isNaN(parsed) ? 30 : Math.max(1, parsed);
    }
  }
  return { days };
}

function fmtPct(n: number, of: number): string {
  if (of === 0) return "—";
  return `${((n / of) * 100).toFixed(0)}%`;
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(r));
}

async function main() {
  const { days } = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const events = await selectAll<EventRow>(() =>
    supabase().from("sukoon_analytics_events").select("user_id, name, props, created_at").gte("created_at", since),
  );

  console.log(`\nSukoon analytics — last ${days} day(s), ${events.length} event(s), since ${since}\n`);

  // ---- Activation funnel: onboarding steps 1..6 -> completed ----------------
  // The wizard has 6 real steps, but `step` arrives as a client-submitted
  // analytics prop (POST /analytics/events) with no server-side magnitude
  // bound (sukoonAnalyticsPropValueSchema allows any number) — clamp here so
  // a bogus/malicious huge value can't blow up the "reached every step <= N"
  // loop below into iterating millions of times.
  const MAX_ONBOARDING_STEP = 6;
  const stepReached = new Map<number, Set<string>>();
  const completed = new Set<string>();
  for (const e of events) {
    if (e.name === "onboarding_step_viewed") {
      const step = Number(e.props.step);
      if (!Number.isFinite(step) || step < 1) continue;
      // A user who reached step N also reached every step <= N.
      for (let s = 1; s <= Math.min(step, MAX_ONBOARDING_STEP); s++) {
        if (!stepReached.has(s)) stepReached.set(s, new Set());
        stepReached.get(s)!.add(e.user_id);
      }
    } else if (e.name === "onboarding_completed") {
      completed.add(e.user_id);
    }
  }
  const startedCount = stepReached.get(1)?.size ?? 0;
  console.log("Activation funnel (onboarding)");
  const funnelRows: string[][] = [];
  for (let step = 1; step <= 6; step++) {
    const n = stepReached.get(step)?.size ?? 0;
    funnelRows.push([`Step ${step}`, String(n), fmtPct(n, startedCount)]);
  }
  funnelRows.push(["Completed", String(completed.size), fmtPct(completed.size, startedCount)]);
  printTable(["stage", "users", "% of step 1"], funnelRows);

  // ---- DAU: distinct users per calendar day ---------------------------------
  const byDay = new Map<string, Set<string>>();
  for (const e of events) {
    const day = e.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day)!.add(e.user_id);
  }
  const days_sorted = [...byDay.keys()].sort();
  console.log("\nDAU (distinct users with any event, per day)");
  printTable(
    ["date", "dau"],
    days_sorted.map((d) => [d, String(byDay.get(d)!.size)]),
  );

  // ---- Feature usage: touch-rate among users active in the window ----------
  const activeUsers = new Set(events.map((e) => e.user_id));
  const touchedBy = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.name !== "feature_viewed") continue;
    const feature = String(e.props.feature ?? "unknown");
    if (!touchedBy.has(feature)) touchedBy.set(feature, new Set());
    touchedBy.get(feature)!.add(e.user_id);
  }
  console.log(`\nFeature usage (${activeUsers.size} active users in window)`);
  printTable(
    ["feature", "users", "% of active"],
    [...touchedBy.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([feature, users]) => [feature, String(users.size), fmtPct(users.size, activeUsers.size)]),
  );

  // ---- Cap hits by feature ----------------------------------------------------
  const capHits = new Map<string, number>();
  for (const e of events) {
    if (e.name !== "cap_hit") continue;
    const feature = String(e.props.feature ?? "unknown");
    capHits.set(feature, (capHits.get(feature) ?? 0) + 1);
  }
  console.log("\nCap hits (feature → count)");
  printTable(
    ["feature", "hits"],
    [...capHits.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => [f, String(c)]),
  );

  // ---- Paywall views / CTA clicks / conversions ------------------------------
  const paywallViews = new Map<string, number>();
  const paywallClicks = new Map<string, number>();
  let trialStarted = 0;
  const conversions = new Map<string, number>();
  for (const e of events) {
    if (e.name === "paywall_viewed") {
      const f = String(e.props.feature ?? "unknown");
      paywallViews.set(f, (paywallViews.get(f) ?? 0) + 1);
    } else if (e.name === "paywall_cta_clicked") {
      const key = `${e.props.feature ?? "unknown"} / ${e.props.cta ?? "unknown"}`;
      paywallClicks.set(key, (paywallClicks.get(key) ?? 0) + 1);
    } else if (e.name === "trial_started") {
      trialStarted++;
    } else if (e.name === "subscription_activated") {
      const tier = String(e.props.tier ?? "unknown");
      conversions.set(tier, (conversions.get(tier) ?? 0) + 1);
    }
  }
  const totalViews = [...paywallViews.values()].reduce((a, b) => a + b, 0);
  const totalConversions = [...conversions.values()].reduce((a, b) => a + b, 0);
  console.log(`\nPaywall views (by feature) — ${totalViews} total`);
  printTable(
    ["feature", "views"],
    [...paywallViews.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => [f, String(c)]),
  );
  console.log("\nPaywall CTA clicks");
  printTable(
    ["feature / cta", "clicks"],
    [...paywallClicks.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, String(c)]),
  );
  console.log(
    `\nTrials started: ${trialStarted}  |  Conversions (subscription_activated): ${totalConversions} (${fmtPct(totalConversions, totalViews)} of paywall views)`,
  );
  for (const [tier, count] of conversions) console.log(`  ${tier}: ${count}`);

  // ---- Crisis events by level (AGGREGATE ONLY — never the message) ----------
  const crisisByLevel = new Map<string, number>();
  for (const e of events) {
    if (e.name !== "crisis_detected") continue;
    const level = String(e.props.level ?? "unknown");
    crisisByLevel.set(level, (crisisByLevel.get(level) ?? 0) + 1);
  }
  console.log("\nCrisis events by level (aggregate counts only)");
  printTable(
    ["level", "count"],
    ["low", "moderate", "high", "critical"].map((lvl) => [lvl, String(crisisByLevel.get(lvl) ?? 0)]),
  );

  console.log("");
}

main().catch((err) => {
  console.error("\nsukoon-analytics-report failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
