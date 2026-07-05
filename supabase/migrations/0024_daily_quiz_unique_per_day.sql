-- 0024_daily_quiz_unique_per_day.sql
-- Nothing in 0022 stopped two daily_quiz tests from being scheduled on the
-- same day — the dashboard's "Today" card assumes exactly one. Enforce it at
-- the DB level instead of just hoping ingestion never double-books a date.

create unique index if not exists tests_daily_quiz_scheduled_date_key
  on public.tests(scheduled_date)
  where kind = 'daily_quiz' and scheduled_date is not null;
