-- 0006_tests.sql
-- Assembled tests (full PYQ papers, sectionals, daily quizzes, custom) and
-- their ordered question membership.

create table public.tests (
  id               uuid primary key default gen_random_uuid(),
  title_i18n       jsonb       not null,
  kind             test_kind   not null,
  paper_code       text,
  duration_minutes int,
  total_marks      int,
  is_published     boolean     not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_tests_updated_at
  before update on public.tests
  for each row execute function public.set_updated_at();

create table public.test_questions (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.tests(id)     on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  order_index int  not null default 0,
  marks       int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (test_id, question_id)
);

create index test_questions_test_idx     on public.test_questions(test_id, order_index);
create index test_questions_question_idx on public.test_questions(question_id);

create trigger trg_test_questions_updated_at
  before update on public.test_questions
  for each row execute function public.set_updated_at();
