-- 0059_notification_schedule_push_tracking.sql
-- The push sender job (apps/api/src/push/sender.ts) drains notification_schedule
-- the same rows the in-app bell already reads — but a push must fire exactly
-- once per row, unlike the bell's idempotent re-list. pushed_at tracks that.

alter table public.notification_schedule add column pushed_at timestamptz;

create index notification_schedule_unpushed_idx
  on public.notification_schedule(scheduled_for)
  where status = 'pending' and pushed_at is null;
