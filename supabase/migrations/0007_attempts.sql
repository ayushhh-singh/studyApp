-- 0007_attempts.sql
-- A user's run at a test (or an ad-hoc practice set when test_id is null) and
-- the per-question answers within it.

create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users_profile(id) on delete cascade,
  test_id      uuid references public.tests(id) on delete set null,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  score        numeric,
  total        numeric,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index attempts_user_idx on public.attempts(user_id, started_at desc);
create index attempts_test_idx on public.attempts(test_id);

create trigger trg_attempts_updated_at
  before update on public.attempts
  for each row execute function public.set_updated_at();

create table public.attempt_answers (
  id                 uuid primary key default gen_random_uuid(),
  attempt_id         uuid not null references public.attempts(id)  on delete cascade,
  question_id        uuid not null references public.questions(id) on delete cascade,
  chosen_option_key  text,
  is_correct         boolean,
  time_spent_seconds int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index attempt_answers_attempt_idx  on public.attempt_answers(attempt_id);
create index attempt_answers_question_idx on public.attempt_answers(question_id);

create trigger trg_attempt_answers_updated_at
  before update on public.attempt_answers
  for each row execute function public.set_updated_at();
