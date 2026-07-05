-- 0021_llm_calls.sql
-- Per-call Anthropic usage/cost log. Written by apps/api/src/lib/anthropic.ts
-- so every structured/streaming call has a token + cost trail for ops
-- dashboards. user_id is nullable — ingestion scripts have no request user.

create table public.llm_calls (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users_profile(id) on delete set null,
  model            text not null,
  purpose          text not null,           -- e.g. "translate", "answer_evaluation"
  input_tokens     int not null default 0,
  output_tokens    int not null default 0,
  cost_usd         numeric not null default 0,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index llm_calls_user_idx    on public.llm_calls(user_id, created_at desc);
create index llm_calls_purpose_idx on public.llm_calls(purpose, created_at desc);
