-- 0043_node_mastery.sql
-- Mastery engine: per-user, per-syllabus-node mastery derived from graded MCQ
-- answers (accuracy x volume x recency, 30-day recency decay). One row per
-- (user, node); recomputed after each attempt submit and nightly. The score is
-- honest SRS logic in a game skin — Gold fades back to Silver when a node goes
-- untouched because the recency factor decays. Formula documented in
-- /docs/mastery.md; thresholds live in apps/api/src/mastery/config.ts.

create type mastery_level as enum ('unseen', 'bronze', 'silver', 'gold', 'exam_ready');

create table public.node_mastery (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users_profile(id) on delete cascade,
  syllabus_node_id uuid not null references public.syllabus_nodes(id) on delete cascade,
  level            mastery_level not null default 'unseen',
  score            numeric(5,2) not null default 0,
  -- Snapshot inputs so a stale row is explainable without re-querying.
  meta             jsonb not null default '{}'::jsonb,
  computed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, syllabus_node_id)
);

create index node_mastery_user_idx on public.node_mastery(user_id);
create index node_mastery_node_idx on public.node_mastery(syllabus_node_id);

create trigger trg_node_mastery_updated_at
  before update on public.node_mastery
  for each row execute function public.set_updated_at();

alter table public.node_mastery enable row level security;
create policy dev_permissive_all on public.node_mastery
  for all to anon, authenticated using (true) with check (true);
