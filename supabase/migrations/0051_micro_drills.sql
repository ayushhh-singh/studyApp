-- 0051_micro_drills.sql
-- Micro-drills: short, targeted answer-writing practice against a single
-- rubric dimension (currently always structure_flow — intro/conclusion
-- practice). One row per drill session; `items` carries the 3 questions +
-- the student's responses + scores as they're filled in, so a session is a
-- single upsertable row rather than a child table.

create table public.drill_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users_profile(id) on delete cascade,
  drill_type     text not null check (drill_type in ('intro', 'conclusion')),
  dimension_key  text not null,
  status         text not null default 'pending' check (status in ('pending', 'complete')),
  items          jsonb not null default '[]'::jsonb,
  overall_pct    numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index drill_sessions_user_idx on public.drill_sessions(user_id, created_at desc);

create trigger trg_drill_sessions_updated_at
  before update on public.drill_sessions
  for each row execute function public.set_updated_at();

alter table public.drill_sessions enable row level security;
create policy dev_permissive_all on public.drill_sessions
  for all to anon, authenticated using (true) with check (true);
