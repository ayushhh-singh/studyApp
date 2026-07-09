-- 0063_answer_test_sessions.sql
-- Timed multi-question Answer-Writing test sessions (yearly full paper /
-- sectional / mock / custom) — a thin, resumable wrapper around an existing
-- `tests` row. Every question within a session is still just a normal
-- `answer_submissions` row (typed or handwritten); the OCR/evaluation
-- pipeline is completely unchanged. See apps/api/src/services/answer-sessions.ts.

create table public.answer_test_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users_profile(id) on delete cascade,
  test_id          uuid not null references public.tests(id) on delete cascade,
  started_at       timestamptz not null default now(),
  duration_minutes int,
  submitted_at     timestamptz,
  status           text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Mirrors findActiveAttempt's resume pattern: at most one in-progress
-- session per (user, test) is ever looked up/reused.
create index answer_test_sessions_active_idx
  on public.answer_test_sessions(user_id, test_id) where submitted_at is null;

create trigger trg_answer_test_sessions_updated_at
  before update on public.answer_test_sessions
  for each row execute function public.set_updated_at();

alter table public.answer_submissions
  add column answer_session_id uuid references public.answer_test_sessions(id) on delete set null,
  add column session_order_index int;

create index answer_submissions_session_idx on public.answer_submissions(answer_session_id);

-- Owner-only RLS, matching 0053/0058's established shape.
alter table public.answer_test_sessions enable row level security;

create policy owner_select on public.answer_test_sessions
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.answer_test_sessions
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.answer_test_sessions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
