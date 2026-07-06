-- 0039_notification_schedule.sql
-- Scheduled in-app notifications (quiz ready, streak at risk ~8 PM IST, SRS
-- due). Consumed in-app for now via a bell/list; web push arrives in Session 21
-- reading the same rows. Generated idempotently per (user, dedupe_key) so a
-- re-run (hourly scheduler or on-load self-heal) never duplicates a day's nudge.

create type notification_type   as enum ('quiz_ready', 'streak_at_risk', 'srs_due');
create type notification_status as enum ('pending', 'read', 'dismissed');

create table public.notification_schedule (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users_profile(id) on delete cascade,
  type          notification_type   not null,
  status        notification_status not null default 'pending',
  -- When the notification becomes relevant (5 AM quiz, ~8 PM streak nudge, …).
  -- The in-app list surfaces rows whose scheduled_for has passed; web push will
  -- later fire at this instant.
  scheduled_for timestamptz not null,
  title_i18n    jsonb not null,
  body_i18n     jsonb not null,
  -- In-app deep link (locale is prefixed client-side), e.g. "/practice/test/…".
  link          text,
  -- One nudge per (user, dedupe_key) — e.g. 'quiz_ready:2026-07-07'.
  dedupe_key    text not null,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index notification_schedule_active_idx
  on public.notification_schedule(user_id, scheduled_for desc)
  where status = 'pending';

create trigger trg_notification_schedule_updated_at
  before update on public.notification_schedule
  for each row execute function public.set_updated_at();

-- Dev-permissive RLS (same "REPLACED IN AUTH PHASE" pattern as 0013). Table
-- grants come from 0015's default privileges automatically.
alter table public.notification_schedule enable row level security;
create policy dev_permissive_all on public.notification_schedule
  for all to anon, authenticated using (true) with check (true);
