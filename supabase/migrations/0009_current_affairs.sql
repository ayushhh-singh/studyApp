-- 0009_current_affairs.sql
-- AI-summarized current affairs items (UP-specific focus), optionally linked to
-- syllabus nodes and generated practice MCQs.

create table public.current_affairs_items (
  id                uuid primary key default gen_random_uuid(),
  date              date        not null,
  category          text,
  is_up_specific    boolean     not null default false,
  title_i18n        jsonb       not null,
  summary_i18n      jsonb,
  detail_i18n       jsonb,
  source_urls       text[],
  syllabus_node_ids uuid[]      not null default '{}'::uuid[],
  mcq_question_ids  uuid[]      not null default '{}'::uuid[],
  is_published      boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index current_affairs_date_idx on public.current_affairs_items(date desc);
create index current_affairs_up_idx   on public.current_affairs_items(is_up_specific);

create trigger trg_current_affairs_updated_at
  before update on public.current_affairs_items
  for each row execute function public.set_updated_at();
