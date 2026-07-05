-- 0022_exam_calendar_and_daily_quiz.sql
-- Official exam calendar powering the dashboard's "days until next exam"
-- countdown (see 0023 for the verified seed row — dates are NEVER seeded
-- from memory, only from a checked web search), plus a scheduled_date on
-- tests so a specific day's daily_quiz can be looked up unambiguously.

create table public.exam_calendar (
  id           uuid primary key default gen_random_uuid(),
  exam_stage   exam_stage  not null,
  title_i18n   jsonb       not null,
  exam_date    date        not null,
  year         int         not null,
  is_tentative boolean     not null default false,
  notes_i18n   jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index exam_calendar_date_idx on public.exam_calendar(exam_stage, exam_date);

create trigger trg_exam_calendar_updated_at
  before update on public.exam_calendar
  for each row execute function public.set_updated_at();

-- scheduled_date: which calendar day a daily_quiz test targets. kind alone is
-- ambiguous once more than one daily_quiz test exists — the dashboard's
-- "Today" card needs to find *today's* quiz specifically.
alter table public.tests
  add column if not exists scheduled_date date;

create index tests_daily_quiz_date_idx on public.tests(kind, scheduled_date) where kind = 'daily_quiz';
