/**
 * Sukoon admin cost dashboard (Session 13 hardening; cache hit-rate added in a
 * later audit — see docs/operations.md's Weekly ops routine) — per-model daily
 * spend, summed from the shared llm_calls ledger (written by lib/anthropic.ts
 * on every model call). Sukoon's calls all use a `sukoon_` purpose prefix, so
 * `purpose LIKE 'sukoon_%'` isolates them cleanly. We sum the STORED cost_usd
 * (what was actually recorded at call time) — the honest ledger figure, not a
 * re-priced estimate.
 *
 * Cache hit-rate mirrors Neev's `pnpm cost:report`
 * (apps/api/scripts/cost-report.ts): a call counts as a cache hit iff its
 * ledger row has cache_read_tokens > 0, and `by_purpose` collapses model
 * splits (e.g. sukoon_saathi_chat's haiku/sonnet escalation) into one row per
 * purpose so a regression on any one purpose is a single glance rather than
 * mental arithmetic across the per-(purpose,model) rows. Live-verified against
 * the cloud DB at the time this was added: `sukoon_meditation_script` (its
 * system head clears haiku's ~4096-token minimum) and `sukoon_weekly_insight`
 * (its system head clears sonnet's ~1024-token minimum) both show REAL cache
 * hits. `sukoon_saathi_chat` and `sukoon_crisis_classify` both set
 * `cache: true` but their heads sit under the ACTIVE call's model floor most
 * of the time (see prompts/saathi.ts and services/crisis/classifier.ts's own
 * comments), so a low/0% rate there is expected, not automatically a bug —
 * don't "fix" it without first checking whether the head has grown past the
 * floor. Note `sukoon_saathi_chat` specifically: on the sonnet-escalated path
 * its head DOES clear sonnet's floor, so watch for cache_write_tokens > 0
 * with cache_read_tokens staying at 0 over time — that would mean escalated
 * turns are writing the cache but never landing close enough together to read
 * it back inside the 5-minute TTL, worth a closer look once real traffic
 * volume makes the pattern clear (too few calls to tell at the time of writing).
 *
 * Admin-only (mounted behind requireAdmin in routes/admin.ts).
 */
import type { SukoonCostSummary, SukoonCostRow, SukoonCostDay, SukoonCostByPurpose } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { selectAll } from "../../lib/paginate.js";
import { istDateString } from "../../lib/ist.js";

interface CallRow {
  purpose: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

export async function getSukoonCostSummary(days: number): Promise<SukoonCostSummary> {
  const clampedDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 180);
  const since = new Date(Date.now() - clampedDays * 86_400_000).toISOString();

  // Page past PostgREST's 1000-row cap (this ledger grows unbounded); the
  // created_at order makes the pagination stable.
  const calls = await selectAll<CallRow>(() =>
    supabase()
      .from("llm_calls")
      .select("purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, created_at")
      .like("purpose", "sukoon_%")
      .gte("created_at", since)
      .order("created_at", { ascending: true }),
  );

  const byPurposeModel = new Map<string, SukoonCostRow>();
  const byPurpose = new Map<string, Omit<SukoonCostByPurpose, "cache_hit_rate" | "share_of_total_cost">>();
  const byDay = new Map<string, SukoonCostDay>();
  let totalCost = 0;

  for (const r of calls) {
    const cost = r.cost_usd ?? 0;
    const cacheRead = r.cache_read_tokens ?? 0;
    const cacheWrite = r.cache_write_tokens ?? 0;
    const isCacheHit = cacheRead > 0;
    totalCost += cost;

    const pmKey = `${r.purpose}::${r.model}`;
    const pm = byPurposeModel.get(pmKey) ?? {
      purpose: r.purpose,
      model: r.model,
      calls: 0,
      calls_with_cache_hit: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0,
    };
    pm.calls += 1;
    if (isCacheHit) pm.calls_with_cache_hit += 1;
    pm.input_tokens += r.input_tokens ?? 0;
    pm.output_tokens += r.output_tokens ?? 0;
    pm.cache_read_tokens += cacheRead;
    pm.cache_write_tokens += cacheWrite;
    pm.cost_usd += cost;
    byPurposeModel.set(pmKey, pm);

    const p = byPurpose.get(r.purpose) ?? {
      purpose: r.purpose,
      calls: 0,
      calls_with_cache_hit: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0,
    };
    p.calls += 1;
    if (isCacheHit) p.calls_with_cache_hit += 1;
    p.cache_read_tokens += cacheRead;
    p.cache_write_tokens += cacheWrite;
    p.cost_usd += cost;
    byPurpose.set(r.purpose, p);

    const day = istDateString(new Date(r.created_at).getTime());
    const d = byDay.get(day) ?? { date: day, cost_usd: 0, calls: 0 };
    d.cost_usd += cost;
    d.calls += 1;
    byDay.set(day, d);
  }

  // Floored at 0: the ledger has no DB-level check that cost_usd >= 0 (a
  // manual correction row could in principle be negative), and every cost_usd
  // field on the response schema is zod .min(0) — an unclamped negative would
  // throw on `sukoonCostSummaryResponseSchema.parse` in the route and 500 the
  // whole dashboard rather than just reporting an odd number.
  const round = (n: number) => Math.max(0, Math.round(n * 1e6) / 1e6);
  // Also capped at 1 for the two ratio fields (zod .min(0).max(1)) — safe even
  // though calls_with_cache_hit/calls can't exceed 1 by construction, this
  // guards the cost-derived share_of_total_cost against the same negative-row
  // edge case above.
  const ratio01 = (n: number) => Math.min(1, round(n));
  const by_purpose_model = [...byPurposeModel.values()]
    .map((r) => ({ ...r, cost_usd: round(r.cost_usd) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const by_purpose: SukoonCostByPurpose[] = [...byPurpose.values()]
    .map((p) => ({
      ...p,
      cache_hit_rate: p.calls > 0 ? ratio01(p.calls_with_cache_hit / p.calls) : null,
      cost_usd: round(p.cost_usd),
      share_of_total_cost: totalCost > 0 ? ratio01(p.cost_usd / totalCost) : null,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const daily = [...byDay.values()]
    .map((d) => ({ ...d, cost_usd: round(d.cost_usd) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days: clampedDays,
    since,
    total_cost_usd: round(totalCost),
    total_calls: calls.length,
    by_purpose_model,
    by_purpose,
    daily,
  };
}
