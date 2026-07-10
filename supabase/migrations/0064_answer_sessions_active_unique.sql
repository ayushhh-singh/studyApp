-- 0064_answer_sessions_active_unique.sql
-- Same race as 0025_attempts_active_unique.sql, for answer_test_sessions:
-- two concurrent "Start"/resume requests (double-click, slow network) could
-- both pass startAnswerSession's find-active-session check before either
-- insert lands, creating two live in_progress sessions on the same
-- (user, test). The plain index from 0063 doesn't stop this. A unique
-- index makes the second insert fail with 23505 instead; the service layer
-- falls back to returning the winning row (mirrors startAttempt exactly).
drop index if exists public.answer_test_sessions_active_idx;
create unique index answer_test_sessions_active_idx
  on public.answer_test_sessions (user_id, test_id)
  where submitted_at is null;
