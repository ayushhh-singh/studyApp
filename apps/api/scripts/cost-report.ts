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

interface LlmCallRow {
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  created_at: string;
}

interface Bucket {
  purpose: string;
  model: string;
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

function isModelId(m: string): m is ModelId {
  return m in MODEL_PRICING;
}

async function main(): Promise<void> {
  const { days } = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const { data, error } = await supabase()
    .from("llm_calls")
    .select("purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at")
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

  // Group by (purpose, model).
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = `${r.purpose}::${r.model}`;
    const b = buckets.get(key) ?? {
      purpose: r.purpose,
      model: r.model,
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
    const costIntro = costFromPriceSet(schedule.intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens);
    const costStandard = costFromPriceSet(
      schedule.standard,
      b.inputTokens,
      b.outputTokens,
      b.cacheReadTokens,
      b.cacheWriteTokens,
    );
    totalIntro += costIntro;
    totalStandard += costStandard;

    console.log(
      [
        b.purpose.padEnd(24),
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

  // Cost per evaluation: total answer_eval_* cost / number of real (non-replayed)
  // evaluation runs — each run calls answer_eval_analysis exactly once.
  const evalPurposes = sorted.filter((b) => b.purpose.startsWith("answer_eval_"));
  const evalCostIntro = evalPurposes.reduce((sum, b) => {
    if (!isModelId(b.model)) return sum;
    return (
      sum + costFromPriceSet(MODEL_PRICING[b.model].intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens)
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
      sum + costFromPriceSet(MODEL_PRICING[b.model].intro, b.inputTokens, b.outputTokens, b.cacheReadTokens, b.cacheWriteTokens)
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
}

main().catch((err) => {
  console.error("\ncost:report failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
