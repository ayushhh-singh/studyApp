-- 0011_study_plans_doubts.sql
-- AI-generated study plans and the RAG doubt-solving chat (threads + messages).

create table public.study_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users_profile(id) on delete cascade,
  target_date       date,
  plan              jsonb not null default '{}'::jsonb,
  generated_by_model text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index study_plans_user_idx on public.study_plans(user_id);
-- At most one active plan per user.
create unique index study_plans_one_active_idx on public.study_plans(user_id) where is_active;

create trigger trg_study_plans_updated_at
  before update on public.study_plans
  for each row execute function public.set_updated_at();

create table public.doubt_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users_profile(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index doubt_threads_user_idx on public.doubt_threads(user_id, updated_at desc);

create trigger trg_doubt_threads_updated_at
  before update on public.doubt_threads
  for each row execute function public.set_updated_at();

create table public.doubt_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.doubt_threads(id) on delete cascade,
  role       doubt_role not null,
  content    text not null,
  citations  jsonb,                    -- [{ source_type, source_id, chunk_text, ... }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index doubt_messages_thread_idx on public.doubt_messages(thread_id, created_at);

create trigger trg_doubt_messages_updated_at
  before update on public.doubt_messages
  for each row execute function public.set_updated_at();
