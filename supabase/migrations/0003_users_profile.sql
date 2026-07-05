-- 0003_users_profile.sql
-- App-level user profile. Standalone uuid PK (NOT referencing auth.users) until
-- the Auth phase (Session 15) — the pre-auth dev user is seeded with a fixed id.

create table public.users_profile (
  id               uuid primary key default gen_random_uuid(),
  display_name     text,
  preferred_locale locale      not null default 'hi',
  target_exam_year int,
  medium           locale      not null default 'hi',
  plan             user_plan   not null default 'free',
  streak_count     int         not null default 0,
  last_active_date date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_users_profile_updated_at
  before update on public.users_profile
  for each row execute function public.set_updated_at();
