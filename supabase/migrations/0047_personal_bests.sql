-- 0047_personal_bests.sql
-- Personal best per CSAT node for Time Attack — the "beat your own score" loop.
-- syllabus_node_id is always set (the CSAT paper root stands in for "All CSAT")
-- so the unique key never sees a NULL. Best = most correct, tie-broken by fastest.

create table public.personal_bests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users_profile(id) on delete cascade,
  mode              text not null default 'time_attack',
  syllabus_node_id  uuid not null references public.syllabus_nodes(id) on delete cascade,
  best_correct      int not null,
  best_total        int not null,
  best_time_seconds int,
  best_combo        int not null default 0,
  achieved_at       timestamptz not null default now(),
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, mode, syllabus_node_id)
);

create index personal_bests_user_mode_idx on public.personal_bests(user_id, mode);

create trigger trg_personal_bests_updated_at
  before update on public.personal_bests
  for each row execute function public.set_updated_at();

alter table public.personal_bests enable row level security;
create policy dev_permissive_all on public.personal_bests
  for all to anon, authenticated using (true) with check (true);
