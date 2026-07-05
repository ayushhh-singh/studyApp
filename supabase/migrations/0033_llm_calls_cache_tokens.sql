-- 0033_llm_calls_cache_tokens.sql
-- Cost-hardening session: prompt caching lands in lib/anthropic.ts, which
-- means llm_calls needs to record cache read/write tokens separately from
-- plain input tokens (they're billed at 0.1x / 1.25x the base input price
-- respectively — see estimateCostUsd in lib/models.ts) so cache hit rate and
-- the actual cost saving are visible per call, not just folded into the
-- opaque cost_usd total.

alter table public.llm_calls
  add column if not exists cache_read_tokens  int not null default 0,
  add column if not exists cache_write_tokens int not null default 0;
