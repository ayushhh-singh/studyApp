-- =============================================================================
-- 0090_sukoon_reminders_garden.sql — Session 12 (blueprint F11): reminders,
-- notification preferences, and the "Sukoon Garden" gentle-gamification data.
--
-- Self-contained per CLAUDE.md's Sukoon rules: sukoon_notification_log is its
-- own table (the only FK is auth.users), and the three new sukoon_profiles
-- columns are plain per-type opt-outs the user controls from Settings. Growth
-- points for the Garden are NOT stored anywhere — they're computed on read
-- from real activity already in sukoon_mood_entries / sukoon_exercise_sessions
-- / sukoon_journal_entries (see services/garden.ts), so there is no counter
-- here that could ever be decremented — matching the blueprint's explicit
-- anti-dark-pattern rule ("grows slowly, never dies or regresses").
--
-- The actual PUSH SEND mechanism (lib/push.ts's sendPush + the
-- push_subscriptions/push_preferences Neev tables) is deliberately REUSED,
-- not duplicated — see services/reminders.ts's header comment for why that's
-- a documented exception to the no-FK-into-Neev-tables rule (there is only
-- ONE browser push subscription per device regardless of which app section
-- asked for permission, since integrated-mode Sukoon shares Neev's own
-- service worker/origin).
-- =============================================================================

alter table public.sukoon_profiles
  add column if not exists mood_reminder_enabled boolean not null default true,
  add column if not exists journey_reminder_enabled boolean not null default true,
  add column if not exists exam_eve_reminder_enabled boolean not null default true;

-- One row per (user, type, IST day) a reminder was actually SENT — the
-- idempotency guard for the hourly cron (services/reminders.ts): a user who
-- hasn't checked in by their reminder_time must be nudged ONCE, not every
-- hour until they do. Append-only; never updated/deleted by the app itself.
create table if not exists public.sukoon_notification_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('mood_reminder', 'journey_reminder', 'exam_eve')),
  day        date not null,
  created_at timestamptz not null default now(),
  unique (user_id, type, day)
);
create index if not exists sukoon_notification_log_user_idx
  on public.sukoon_notification_log (user_id, day desc);

-- RLS + explicit grants (mirrors 0079 exactly — tables created over a direct
-- db push --db-url connection don't get Supabase's automatic API-role grants,
-- see [[supabase-headless-migrations]]). Owner gets full CRUD like every
-- other personal sukoon_ table (DPDP + Privacy Center convention), even
-- though only the service role writes today.
alter table public.sukoon_notification_log enable row level security;
revoke all on public.sukoon_notification_log from anon, authenticated;
grant all on public.sukoon_notification_log to service_role;
grant select, insert, update, delete on public.sukoon_notification_log to authenticated;

create policy owner_select on public.sukoon_notification_log
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.sukoon_notification_log
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.sukoon_notification_log
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.sukoon_notification_log
  for delete to authenticated using (auth.uid() = user_id);
