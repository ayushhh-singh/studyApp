-- 0042_milestones.sql
-- Achievement milestones (first evaluation, 100 MCQs, 7-day streak, …). Awarded
-- idempotently per (user, key); `seen` gates the one-time dismissible toast.

create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users_profile(id) on delete cascade,
  key         text not null,
  achieved_at timestamptz not null default now(),
  seen        boolean not null default false,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, key)
);

create index milestones_unseen_idx on public.milestones(user_id, achieved_at desc) where seen = false;

create trigger trg_milestones_updated_at
  before update on public.milestones
  for each row execute function public.set_updated_at();

alter table public.milestones enable row level security;
create policy dev_permissive_all on public.milestones
  for all to anon, authenticated using (true) with check (true);
