-- 0025_attempts_active_unique.sql
-- Guards against a genuine race in startAttempt: two concurrent "Start Test"
-- requests (double-click, slow network) could both pass the
-- find-unsubmitted-attempt check before either insert lands, creating two
-- live attempts on the same test. A partial unique index makes the second
-- insert fail with 23505 instead, and the service layer falls back to
-- returning the winning row.
create unique index attempts_one_active_per_test_idx
  on public.attempts (user_id, test_id)
  where submitted_at is null and test_id is not null;
