/**
 * cost:report — last 30 days of Anthropic spend from llm_calls, grouped by
 * purpose and model, with cache hit rate and cost under both the current
 * introductory pricing and the standard pricing that follows it (see
 * lib/models.ts's MODEL_PRICING) so a future price jump is visible ahead of
 * time, not discovered in an invoice.
 *
 *   pnpm cost:report [--days N]
 */
import { MODEL_PRICING, costFromPriceSet, type ModelId } from "../src/lib/models.js";
import { supabase } from "../src/lib/supabase.js";

/** Message Batches API discount — batch rows carry meta.batch=true and are priced at 0.5x. */
const BATCH_DISCOUNT = 0.5;

interface LlmCallRow {
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  meta: { batch?: boolean } | null;
  created_at: string;
}

interface Bucket {
  purpose: string;
  model: string;
  batch: boolean;
  calls: number;
  callsWithCacheHit: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function parseArgs(argv: string[]): { days: number } {
  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") days = Math.max(1, Number(argv[++i]) || 30);
  }
  return { days };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/** Nearest-rank percentile of a numeric list (returns null for an empty list). */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function isModelId(m: string): m is ModelId {
  return m in MODEL_PRICING;
}

// Question-bank health alert thresholds (documented in docs/operations.md).
const REPORT_RATE_ALERT = 0.02; // >2% of a cohort's published MCQs carrying an open user report
const INCONSISTENCY_RATE_ALERT = 0.01; // >1% flagged by the consistency sweep
const RESOLVE_DISAGREEMENT_ALERT = 0.05; // >5% flagged by the blind re-solve audit

interface QualityRow {
  source_kind: string;
  prompt_version: string;
  published_mcq: number;
  reported_questions: number;
  open_reports: number;
  report_rate: number | null;
  consistency_checked: number;
  consistency_flagged: number;
  inconsistency_rate: number | null;
  resolve_checked: number;
  resolve_flagged: number;
  resolve_disagreement_rate: number | null;
}

/** Question-bank quality: report / inconsistency / re-solve-disagreement rates by source_kind + prompt_version. */
async function reportQuestionQuality(): Promise<void> {
  console.log("\n" + "=".repeat(100));
  console.log("Question-bank quality (published MCQs, by source_kind + generation prompt_version)");
  console.log("=".repeat(100));
  const { data, error } = await supabase().from("question_quality").select("*");
  if (error) {
    console.log(`(question_quality unavailable: ${error.message})`);
    return;
  }
  const rows = (data ?? []) as QualityRow[];
  if (rows.length === 0) {
    console.log("No published MCQs.");
    return;
  }
  const header = [
    "source_kind".padEnd(14),
    "prompt".padEnd(10),
    "pub".padStart(6),
    "reports".padStart(9),
    "rep%".padStart(6),
    "incons".padStart(8),
    "incons%".padStart(8),
    "resolve".padStart(9),
    "disag%".padStart(7),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  const alerts: string[] = [];
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
  for (const r of rows) {
    console.log(
      [
        r.source_kind.padEnd(14),
        r.prompt_version.padEnd(10),
        String(r.published_mcq).padStart(6),
        `${r.reported_questions}/${r.open_reports}`.padStart(9),
        pct(r.report_rate).padStart(6),
        `${r.consistency_flagged}/${r.consistency_checked}`.padStart(8),
        pct(r.inconsistency_rate).padStart(8),
        `${r.resolve_flagged}/${r.resolve_checked}`.padStart(9),
        pct(r.resolve_disagreement_rate).padStart(7),
      ].join(" "),
    );
    const cohort = `${r.source_kind}/${r.prompt_version}`;
    if ((r.report_rate ?? 0) > REPORT_RATE_ALERT)
      alerts.push(`report rate ${pct(r.report_rate)} > ${pct(REPORT_RATE_ALERT)} for ${cohort}`);
    if ((r.inconsistency_rate ?? 0) > INCONSISTENCY_RATE_ALERT)
      alerts.push(`inconsistency rate ${pct(r.inconsistency_rate)} > ${pct(INCONSISTENCY_RATE_ALERT)} for ${cohort}`);
    if ((r.resolve_disagreement_rate ?? 0) > RESOLVE_DISAGREEMENT_ALERT)
      alerts.push(`re-solve disagreement ${pct(r.resolve_disagreement_rate)} > ${pct(RESOLVE_DISAGREEMENT_ALERT)} for ${cohort}`);
  }
  console.log("-".repeat(header.length));
  if (alerts.length > 0) {
    console.log("\n⚠️  QUALITY ALERTS:");
    for (const a of alerts) console.log(`   - ${a}`);
    console.log("   → triage the Review Queue's Reported-questions tab and/or re-run the audits (docs/operations.md).");
  } else {
    console.log("All cohorts within quality thresholds.");
  }
}

async function main(): Promise<void> {
  const { days } = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const { data, error } = await supabase()
    .from("llm_calls")
    .select("purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, meta, created_at")
    .gte("created_at", since.toISOString());
  if (error) throw new Error(`llm_calls query failed: ${error.message}`);
  const rows = (data ?? []) as unknown as LlmCallRow[];

  console.log("=".repeat(100));
  console.log(`Cost report — last ${days} days (${rows.length} calls, since ${since.toISOString().slice(0, 10)})`);
  console.log("=".repeat(100));

  if (rows.length === 0) {
    console.log("No llm_calls rows in this window.");
    return;
  }

  // Group by (purpose, model, batch) — batch rows price at 0.5x.
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const isBatch = !!r.meta?.batch;
    const key = `${r.purpose}::${r.model}::${isBatch ? "batch" : "sync"}`;
    const b = buckets.get(key) ?? {
      purpose: r.purpose,
      model: r.model,
      batch: isBatch,
      calls: 0,
      callsWithCacheHit: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    b.calls += 1;
    if (r.cache_read_tokens > 0) b.callsWithCacheHit += 1;
    b.inputTokens += r.input_tokens;
    b.outputTokens += r.output_tokens;
    b.cacheReadTokens += r.cache_read_tokens;
    b.cacheWriteTokens += r.cache_write_tokens;
    buckets.set(key, b);
  }

  const sorted = [...buckets.values()].sort((a, b) => b.calls - a.calls);

  let totalIntro = 0;
  let totalStandard = 0;

  const header = [
    "purpose".padEnd(24),
    "model".padEnd(18),
    "calls".padStart(7),
    "cache hit".padStart(10),
    "in tok".padStart(10),
    "out tok".padStart(10),
    "cache r/w".padStart(12),
    "cost (intro)".padStart(14),
    "cost (std)".padStart(14),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const b of sorted) {
    if (!isModelId(b.model)) {
      console.log(`  (skipping unknown model ${b.model} for purpose ${b.purpose})`);
      continue;
    }
    const schedule = MODEL_PRICING[b.model];
    const disc = b.batch ? BATCH_DISCOUNT : 1;
    const costIntro = costFromPriceSet(schedule.intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens) * disc;
    const costStandard =
      costFromPriceSet(schedule.standard, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens) * disc;
    totalIntro += costIntro;
    totalStandard += costStandard;

    console.log(
      [
        (b.batch ? `${b.purpose}*` : b.purpose).padEnd(24),
        b.model.padEnd(18),
        String(b.calls).padStart(7),
        fmtPct(b.callsWithCacheHit / b.calls).padStart(10),
        String(b.inputTokens).padStart(10),
        String(b.outputTokens).padStart(10),
        `${b.cacheReadTokens}/${b.cacheWriteTokens}`.padStart(12),
        fmtUsd(costIntro).padStart(14),
        fmtUsd(costStandard).padStart(14),
      ].join(" "),
    );
  }

  console.log("-".repeat(header.length));
  console.log(
    [
      "TOTAL".padEnd(24),
      "".padEnd(18),
      "".padStart(7),
      "".padStart(10),
      "".padStart(10),
      "".padStart(10),
      "".padStart(12),
      fmtUsd(totalIntro).padStart(14),
      fmtUsd(totalStandard).padStart(14),
    ].join(" "),
  );
  const jumpPct = totalIntro > 0 ? ((totalStandard - totalIntro) / totalIntro) * 100 : 0;
  console.log(`\nStandard pricing would cost ${jumpPct.toFixed(0)}% more than intro pricing for this window's usage.`);
  if (sorted.some((b) => b.batch)) console.log("(* = Message-Batches API rows, priced at 0.5x.)");

  // Cost per evaluation: total answer_eval_* cost / number of real (non-replayed)
  // evaluation runs — each run calls answer_eval_analysis exactly once.
  const evalPurposes = sorted.filter((b) => b.purpose.startsWith("answer_eval_"));
  const evalCostIntro = evalPurposes.reduce((sum, b) => {
    if (!isModelId(b.model)) return sum;
    return (
      sum +
      costFromPriceSet(MODEL_PRICING[b.model].intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens) *
        (b.batch ? BATCH_DISCOUNT : 1)
    );
  }, 0);
  const analysisCalls = sorted.find((b) => b.purpose === "answer_eval_analysis")?.calls ?? 0;
  console.log(
    analysisCalls > 0
      ? `Cost per evaluation (intro pricing): ${fmtUsd(evalCostIntro / analysisCalls)} (${analysisCalls} evaluation${
          analysisCalls === 1 ? "" : "s"
        } run)`
      : "Cost per evaluation: no evaluations run in this window.",
  );

  // Cost per CA run: no run id is recorded, so this approximates "a run" as
  // one calendar UTC day of ca_* activity (ca:run fires at most a few times a
  // day) — labelled as an approximation, not exact per-invocation cost.
  const caPurposes = sorted.filter((b) => b.purpose.startsWith("ca_"));
  const caCostIntro = caPurposes.reduce((sum, b) => {
    if (!isModelId(b.model)) return sum;
    return (
      sum +
      costFromPriceSet(MODEL_PRICING[b.model].intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens) *
        (b.batch ? BATCH_DISCOUNT : 1)
    );
  }, 0);
  const caDays = new Set(rows.filter((r) => r.purpose.startsWith("ca_")).map((r) => r.created_at.slice(0, 10))).size;
  console.log(
    caDays > 0
      ? `Cost per CA run day (intro pricing, approx. — no run id recorded): ${fmtUsd(caCostIntro / caDays)} (${caDays} day${
          caDays === 1 ? "" : "s"
        } with CA activity)`
      : "Cost per CA run: no current-affairs activity in this window.",
  );

  // Cost per ACCEPTED generated question, from generation_batches (the
  // authoritative per-run cost + acceptance tally; this already reflects the
  // batch discount for nightly runs). Targets: ~₹1.5 sync, ~₹0.9 batch.
  const { data: gbRows, error: gbErr } = await supabase()
    .from("generation_batches")
    .select("kind, requested_count, accepted_count, cost_usd, meta, created_at")
    .gte("created_at", since.toISOString());
  if (gbErr) {
    console.log(`\n(generation_batches unavailable: ${gbErr.message})`);
  } else if ((gbRows ?? []).length === 0) {
    console.log("\nGeneration (qgen): no runs in this window.");
  } else {
    console.log("\n" + "=".repeat(100));
    console.log("Question generation (qgen)");
    console.log("=".repeat(100));
    const agg = (rows: typeof gbRows) => {
      let requested = 0;
      let accepted = 0;
      let cost = 0;
      for (const r of rows) {
        requested += (r as { requested_count: number }).requested_count;
        accepted += (r as { accepted_count: number }).accepted_count;
        cost += Number((r as { cost_usd: number }).cost_usd);
      }
      return { runs: rows.length, requested, accepted, cost };
    };
    const USD_TO_INR = 86;
    const line = (label: string, a: ReturnType<typeof agg>) => {
      const perAccepted = a.accepted ? a.cost / a.accepted : 0;
      const rate = a.requested ? Math.round((a.accepted / a.requested) * 100) : 0;
      console.log(
        `  ${label.padEnd(20)} runs=${String(a.runs).padStart(3)} requested=${String(a.requested).padStart(4)} ` +
          `accepted=${String(a.accepted).padStart(4)} (${rate}%)  cost=${fmtUsd(a.cost)}  per-accepted=${fmtUsd(
            perAccepted,
          )} (~₹${(perAccepted * USD_TO_INR).toFixed(2)})`,
      );
    };
    const sync = (gbRows ?? []).filter((r) => (r.meta as { mode?: string } | null)?.mode !== "batch");
    const batch = (gbRows ?? []).filter((r) => (r.meta as { mode?: string } | null)?.mode === "batch");
    line("ALL", agg(gbRows ?? []));
    if (sync.length) line("sync", agg(sync));
    if (batch.length) line("batch", agg(batch));
    console.log("  Targets: ~₹1.5 per accepted (sync), ~₹0.9 (batch).");
  }

  // -------------------------------------------------------------------------
  // Mentor FAQ cache + latency (Session 26.5) — from the `mentor_doubt_lookup`
  // events the doubt pipeline logs on every lookup. Makes threshold tuning
  // data-driven (hit rate + how close the near-misses were) and surfaces the
  // "long in-depth answers feel slow" latency as real p50/p95 numbers.
  // -------------------------------------------------------------------------
  interface LookupProps {
    outcome: string;
    mode?: string;
    depth?: string;
    nearest_similarity: number | null;
    model_call?: boolean;
    ttft_ms: number | null;
    total_ms: number | null;
  }
  const { data: lookupRows, error: lookupErr } = await supabase()
    .from("events")
    .select("props, created_at")
    .eq("name", "mentor_doubt_lookup")
    .gte("created_at", since.toISOString());

  console.log("\n" + "=".repeat(100));
  console.log("Mentor FAQ cache + latency");
  console.log("=".repeat(100));
  if (lookupErr) {
    console.log(`(mentor_doubt_lookup events unavailable: ${lookupErr.message})`);
  } else {
    const lookups = ((lookupRows ?? []) as { props: LookupProps }[]).map((r) => r.props);
    if (lookups.length === 0) {
      console.log("No mentor doubt lookups in this window.");
    } else {
      const isHit = (o: string) => o === "hit_silent" || o === "hit_similar" || o === "hit_compressed";
      // Cache-eligible = quick-doubt lookups only. Personal doubts and teacher
      // lessons never touch the cache, so they're excluded from the hit-rate.
      const eligible = lookups.filter((l) => l.outcome !== "personal" && l.outcome !== "teacher");
      const hits = eligible.filter((l) => isHit(l.outcome));
      const count = (o: string) => lookups.filter((l) => l.outcome === o).length;
      const hitRate = eligible.length ? hits.length / eligible.length : 0;

      const missSims = lookups
        .filter((l) => l.outcome === "miss" && typeof l.nearest_similarity === "number")
        .map((l) => l.nearest_similarity as number);
      const avgMissSim = missSims.length ? missSims.reduce((a, b) => a + b, 0) / missSims.length : null;

      console.log(
        `  Lookups: ${lookups.length}  (silent=${count("hit_silent")} similar=${count("hit_similar")} ` +
          `compressed=${count("hit_compressed")} miss=${count("miss")} bypass=${count("bypass")} ` +
          `personal=${count("personal")} teacher=${count("teacher")})`,
      );
      console.log(`  Cache hit-rate (eligible): ${fmtPct(hitRate)}  (${hits.length}/${eligible.length})`);
      console.log(
        avgMissSim !== null
          ? `  Avg nearest similarity on MISS: ${avgMissSim.toFixed(3)} (${missSims.length} misses) — ` +
              `close to ${(0.86).toFixed(2)} means the SIMILAR threshold is worth loosening`
          : "  Avg nearest similarity on MISS: n/a (no misses with a candidate)",
      );

      // Latency p50/p95 — split quick-doubt model answers from teacher lessons,
      // since in-depth lessons (web research + a big generation) are the "long
      // answer feels slow" path and shouldn't dilute the quick-doubt numbers.
      const fmtMs = (n: number | null) => (n === null ? "n/a" : `${(n / 1000).toFixed(1)}s`);
      const latLine = (label: string, rows: LookupProps[]) => {
        const ttfts = rows.map((l) => l.ttft_ms).filter((n): n is number => typeof n === "number");
        const totals = rows.map((l) => l.total_ms).filter((n): n is number => typeof n === "number");
        console.log(
          `  ${label} (${rows.length}) — TTFT p50/p95: ${fmtMs(percentile(ttfts, 50))}/${fmtMs(percentile(ttfts, 95))}, ` +
            `total p50/p95: ${fmtMs(percentile(totals, 50))}/${fmtMs(percentile(totals, 95))}`,
        );
      };
      latLine("Quick-doubt model-answer latency", lookups.filter((l) => l.model_call && l.outcome !== "teacher"));
      const teacherRows = lookups.filter((l) => l.outcome === "teacher");
      if (teacherRows.length) latLine("Teacher-lesson latency", teacherRows);
    }
  }

  await reportQuestionQuality();
}

main().catch((err) => {
  console.error("\ncost:report failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
