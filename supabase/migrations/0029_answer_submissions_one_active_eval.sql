-- 0029_answer_submissions_one_active_eval.sql
-- Enforce "at most one in-flight evaluation per user" at the database, closing
-- the TOCTOU gap in the app-level guard: planEvaluation checks for another
-- 'evaluating' row and then claims this one in two separate statements, so two
-- requests for different submissions of the same user could both pass the check
-- before either claim lands. This partial unique index makes the second
-- concurrent claim fail with a unique_violation (23501/23505), which the API
-- maps to a 409. Safe to add now — no user has two 'evaluating' rows.

create unique index if not exists answer_submissions_one_active_eval
  on public.answer_submissions (user_id)
  where status = 'evaluating';
