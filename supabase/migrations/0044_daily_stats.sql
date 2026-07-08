-- 0044_daily_stats.sql
-- Per-IST-day "Perfect Day" ledger: a day is perfect when the user completed the
-- whole guided Today checklist (daily quiz + answer set + revision + reading).
-- Recorded forward-only (sticky true) when the checklist completes — the heatmap
-- computes activity *intensity* live from raw events, but perfect-day state needs
-- the day's due-set, which can't be reconstructed after the fact. Powers the
-- Perfect Day markers on the activity heatmap and the 7-Perfect-Day milestone.

create table public.daily_stats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users_profile(id) on delete cascade,
  date        date not null,
  is_perfect  boolean not null default false,
  meta        jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, date)
);

create index daily_stats_user_date_idx on public.daily_stats(user_id, date);
create index daily_stats_perfect_idx on public.daily_stats(user_id) where is_perfect = true;

create trigger trg_daily_stats_updated_at
  before update on public.daily_stats
  for each row execute function public.set_updated_at();

alter table public.daily_stats enable row level security;
create policy dev_permissive_all on public.daily_stats
  for all to anon, authenticated using (true) with check (true);
